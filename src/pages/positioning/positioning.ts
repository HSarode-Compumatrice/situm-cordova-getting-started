import { Component, ChangeDetectorRef, ElementRef, ViewChild } from '@angular/core';
import { NavController, NavParams, Platform, Events, LoadingController, ToastController } from 'ionic-angular';
import { DomSanitizer } from '@angular/platform-browser';
import { GoogleMaps, GoogleMap, GoogleMapsEvent, GoogleMapOptions, LatLng, ILatLng, GroundOverlayOptions, GroundOverlay, MarkerOptions, MarkerIcon, Marker, PolylineOptions, HtmlInfoWindow } from '@ionic-native/google-maps';
import { MapButtonComponent } from '../../components/mapButton/mapButton';

declare var cordova: any;

const ROUTE_COLOR = '#754967';

// Positioning parameters
const defaultOptionsMap = {
  useDeadReckoning: false,
  interval: 1000,
  indoorProvider: 'INPHONE',
  useBle: true,
  useWifi: true, 
  motionMode: 'BY_FOOT',
  useForegroundService: true,
  outdoorLocationOptions: {
    continuousMode: true,
    userDefinedThreshold: false,
    burstInterval: 1,
    averageSnrThreshold: 25.0
  },
  beaconFilters: [],
  smallestDisplacement: 1.0,
  realtimeUpdateInterval: 1000
};

@Component({
  selector: 'page-positioning',
  templateUrl: 'positioning.html',
})

export class PositioningPage {

  building: any;

  positioning: boolean = false;

  position: any = {
    statusName: '',
    floorIdentifier: '',
    x: -1,
    y: -1,
    accuracy: -1,
    bearing: ''
  }

  floors: any[];
  currentFloor: any;

  map: GoogleMap;
  poiCategories: any[];
  marker: Marker;
  pois: any[];

  accessible: boolean = false;
  navigating: boolean = false;
  route: any;

  constructor(
    public platform: Platform,
    public navCtrl: NavController,
    public navParams: NavParams,
    public events: Events,
    public detector: ChangeDetectorRef,
    public sanitizer: DomSanitizer,
    public loadingCtrl: LoadingController,
    public googleMaps: GoogleMaps,
    public toastCtrl: ToastController
  ) {
    this.building = this.navParams.get('building');
  }

  private showMap(event) {
    if (!this.map) {
      this.platform.ready().then(() => {
        // Shows a loading while the map is not displayed
        let loading = this.createLoading('Loading map...');
        loading.present();
        // Fetchs all floors of a building
        // More details in
        // http://developers.situm.es/sdk_documentation/cordova/jsdoc/1.3.10/symbols/Situm.html#.fetchFloorsFromBuilding
        cordova.plugins.Situm.fetchFloorsFromBuilding(this.building, (res) => {
          this.floors = res;
          this.currentFloor = res[0];

          this.mountMap();

          this.map.one(GoogleMapsEvent.MAP_READY).then(() => {
            this.mountOverlay(loading);
          }).catch((err: any) =>  this.handleError(err, loading));

        });
      });
    }
  }

  private mountMap() {
    let element = this.getElementById('map');
    let options: GoogleMapOptions = {
      camera: {
        target: this.getCenter(this.building),
        zoom: 20
      }
    };
    this.map = GoogleMaps.create(element, options);
  }

  private mountOverlay(loading) {
    let bounds = this.getBounds(this.building);
    let groundOptions: GroundOverlayOptions = {
      url: this.currentFloor.mapUrl,
      bounds: bounds,
      bearing: this.building.rotation * 180 / Math.PI
    }
    this.map.addGroundOverlay(groundOptions).then(() => {
      loading.dismiss();
    }).catch((err: any) => this.handleError(err, loading));
  }

  private showPois() {
    if (!this.map) {
      const message = 'The map must be visible in order to show the POIs';
      this.presentToast(message, 'bottom', null);
      return;
    }
    this.fetchForPOIs(this.building);
  }

  private fetchForPOIs(building) {
    // Fetching for a building's  indoor POIs
    // More details in 
    // http://developers.situm.es/sdk_documentation/cordova/jsdoc/1.3.10/symbols/Situm.html#.fetchIndoorPOIsFromBuilding
    cordova.plugins.Situm.fetchIndoorPOIsFromBuilding(building, (res: any) => {
      this.pois = res;
      if (this.pois.length == 0) {
        const message = 'This building has no POIs';
        this.presentToast(message, 'bottom', null);
        return;
      }
      this.fetchForPOICategories(building);
    });
  }

  private fetchForPOICategories(building) {
    // Fetching for an user's POI categories
    // More details in 
    //http://developers.situm.es/sdk_documentation/cordova/jsdoc/1.3.10/symbols/Situm.html#.fetchPoiCategories
    cordova.plugins.Situm.fetchPoiCategories((res: any) => {
      this.poiCategories = res;
      this.drawPOIsOnMap();
    });
  }

  private drawPOIsOnMap() {
    this.pois.forEach(poi => {
      poi.category = this.findPOICategory(poi);
      let markerPosition: ILatLng = {
        lat: poi.coordinate.latitude,
        lng: poi.coordinate.longitude
      }
      let icon: MarkerIcon = {
        url: poi.category.icon_selected,
        size: {
          height: 35,
          width: 35
        }
      }
      let markerOptions: MarkerOptions = {
        icon: icon,
        position: markerPosition,
        title: `${poi.poiName}`,
      };
      this.createMarker(markerOptions, this.map, false);
    });
  }

  private findPOICategory(poi) {
    return this.poiCategories.find((poiCategory: any) => {
      return poiCategory.poiCategoryCode == poi.category
    });
  }

  private startPositioning() {
    if (this.positioning == true) {
      const message = 'Position listener is already enabled.';
      this.presentToast(message, 'bottom', null);
      return;
    }
    this.platform.ready().then(() => {
      if (!this.map) {
        const message = 'The map must be visible in order to launch the positioning';
        this.presentToast(message, 'bottom', null);
        return;
      }
      this.createPositionMarker();
      const locationOptions = this.mountLocationOptions();

      // Set callback and starts listen onLocationChanged event
      // More details in 
      // http://developers.situm.es/sdk_documentation/cordova/jsdoc/1.3.10/symbols/Situm.html#.startPositioning
      cordova.plugins.Situm.startPositioning(locationOptions, (res: any) => {
        this.positioning = true;
        this.position = res;

        if (!this.position || !this.position.coordinate) return;
        let position = this.mountPositionCoords(this.position);
  
        // Update the navigation
        if (this.navigating) this.updateNavigation(this.position);
        this.marker.setPosition(position);
        this.detector.detectChanges();

      }, (err: any) => {
        console.log('Error when starting positioning', err);
      });
    });
  }

  private mountLocationOptions() {
    let locationOptions = new Array();
    locationOptions.push(this.building);
    defaultOptionsMap['buildingIdentifier'] = this.building.buildingIdentifier,
    locationOptions.push(defaultOptionsMap);
    return locationOptions;
  }

  private mountPositionCoords(position) : ILatLng {
    return {
      lat: position.coordinate.latitude,
      lng: position.coordinate.longitude
    };
  }

  private updateNavigation(position) {
    // Sends a position to the location manager for calculate the navigation progress
    cordova.plugins.Situm.updateNavigationWithLocation([position], function(error) {
      console.log(error);
    }, function (error) {
      console.log(error);
    });
  }

  private stopPositioning() {
    if (this.positioning == false) {
      console.log("Position listener is not enabled.");
      return;
    }
    cordova.plugins.Situm.stopPositioning(() => {
      if (this.marker) this.marker.remove();
      this.positioning = false;
     });
  }

  private showRoute() {
    if (!this.map || (!this.pois || this.pois.length == 0) || !this.positioning) {
      const message = 'The map with the POIs must be visible and the positioning must be started in order to determine the route';
      this.presentToast(message, 'bottom', null);
      return;
    }
    console.log("Position is: " + this.position.bearing.degrees);
    
    let directionsOptionsMap = {
      accesible: this.accessible, 
      startingAngle: this.position.bearing.degrees,
    };
    // Calculates a route between two points
    // In this case, determining route between the current position and the second POI
    // More details in
    // http://developers.situm.es/sdk_documentation/cordova/jsdoc/1.3.10/symbols/Situm.html#.requestDirections
    cordova.plugins.Situm.requestDirections([this.building, this.position.position, this.pois[2], directionsOptionsMap], (route: any) => {
      this.route = route;
      this.drawRouteOnMap(route);
    }, (err: any) => {
      console.error(err);
    });
  }

  private drawRouteOnMap(route) {
    let polylineOptions: PolylineOptions = {
      color: ROUTE_COLOR,
      width: 4,
      points: []
    };
    route.points.forEach(point => {
      polylineOptions.points.push({
        lat: point.coordinate.latitude,
        lng: point.coordinate.longitude
      });
    });
    this.map.addPolyline(polylineOptions);
  }

  private updateAccessible() {
    console.log('Accessible new state:' + this.accessible);
    this.accessible = !this.accessible;
  }

  private createPositionMarker() {
    let defaultOptions: MarkerOptions = {
      position: { lat: 0, lng: 0 },
      title: 'Current position'
    };
    this.createMarker(defaultOptions, this.map, true);
  }

  private requestNavigation() {
    if (this.navigating) {
      const message = 'Navigation is already activated';
      this.presentToast(message, 'bottom', null);
      return;
    }
    // Adds a listener to receive navigation updates when the 
    // updateNavigationWithLocation method is called
    cordova.plugins.Situm.requestNavigationUpdates();
    this.navigating = true;
  }

  private removeNavigation() {
    if (!this.navigating) {
      const message = 'Navigation is already deactivated';
      this.presentToast(message, 'bottom', null);
      return;
    }
    // Removes the listener from navigation updates
    cordova.plugins.Situm.removeNavigationUpdates();
    this.navigating = false;
  }

  private clearCache() {
    // Invalidate all the resources in the cache
    // More details in
    // http://developers.situm.es/sdk_documentation/cordova/jsdoc/1.3.10/symbols/Situm.html#.invalidateCache
    cordova.plugins.Situm.invalidateCache();
  }

  private stablishCache() {
    // Sets the maximum age of a cached response.
    // More details in 
    // http://developers.situm.es/sdk_documentation/cordova/jsdoc/1.3.10/symbols/Situm.html#.setCacheMaxAge
    cordova.plugins.Situm.setCacheMaxAge(7000);
    // Gets the maxium age of a cached response.
    cordova.plugins.Situm.getCacheMaxAge();
  }

  private createMarker(options : MarkerOptions, map, currentPosition) {
    map.addMarker(options).then((marker : Marker) => {
      if (currentPosition) this.marker = marker;
    });
  }

  private handleError(error, loading) {
    if (loading) loading.dismiss();
  }

  private getElementById(id) : HTMLElement {
    return document.getElementById(id);
  }

  private createLoading(msg) {
    return this.loadingCtrl.create({
      content: msg
    });
  }

  private getBounds(building) {
    if (!building) return;
    let boundsSW: LatLng = new LatLng(building.bounds.southWest.latitude, building.bounds.southWest.longitude);
    let boundsNE: LatLng = new LatLng(building.bounds.northEast.latitude, building.bounds.northEast.longitude);
    return [
      { lat: building.bounds.southWest.latitude, lng: building.bounds.southWest.longitude },
      { lat: building.bounds.northEast.latitude, lng: building.bounds.northEast.longitude }
    ];
  }

  private getCenter(building) : LatLng {
    return new LatLng(building.center.latitude, building.center.longitude);
  }

  ionViewWillLeave() {
    this.stopPositioning();
  }

  presentToast(text, position, toastClass) {
    const toast = this.toastCtrl.create({
      message: text,
      duration: 2000,
      position: position,
      cssClass: toastClass ? toastClass : ''
    });
    toast.present();
  }

  mapHidden() {
    if (!this.map) return true;
    return false;
  }

  positioningStopped() {
    if (!this.positioning) return true;
    return false;
  }

  noPois() {
    if (!this.pois || this.pois.length == 0) return true;
    return false;
  }

  routeConditionsNotSet() {
    if (this.noPois() || this.mapHidden() || this.positioningStopped()) return true;
    return false;
  }

  navigationConditionsNotSet() {
    if (this.routeConditionsNotSet() || !this.route) return true;
    return false;
  }

}
