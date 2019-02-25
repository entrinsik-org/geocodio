(function () {
    'use strict';

    function infGmapFeature () {
        return {
            restrict: 'E',
            controller: _.noop,
            controllerAs: 'ctrl',
            bindToController: true,
            scope: {
                feature: '=ngModel'
            },
            templateUrl: '/assets/geocodio/directives/inf-geocodio-feature-tpl.html'
        };
    }

    angular.module('informer')
        .directive('infGeocodioFeature', infGmapFeature);
})();

