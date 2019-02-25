(function () {
    'use strict';

    function config (componentProvider) {
        componentProvider.component('geocodioFeature', '<inf-geocodio-feature ng-model="$component.ngModel"></inf-geocodio-feature>');
    }

    angular.module('informer').config(config);
})();
