'use strict';

const path = require('path');

exports.register = function (server, opts, next) {
    const bundle = server.bundle('geocodio').scan(__dirname, 'public');
    server.injector().inject(bundle);

    server.select('content').route({method: 'GET', path: '/assets/geocodio/images/{path*}', config: {
            auth: false,
            handler: {
                directory: {
                    path: path.resolve(__dirname, './public/images'),
                    listing: false,
                    index: false
                }
            }
        }});


    const installFlowStep = feature => server.driver('flow', require('./lib/flow-step')(server, feature.data.apiKey));

    server.driver('systemFeature', {
        id: 'geocodio',
        name: 'Geocoding by Geocodio',
        editorComponent: 'geocodioFeature',
        description: 'Installs a bulk geo coding flow driver for cleansing address and adding location data',
        isEligible: () => true,
        install: installFlowStep,
        uninstall: () => server.dm('flow').remove('geocodio')
    });

    server.on('start', () => {
        server.app.db.model('SystemFeature').findById('geocodio')
            .then(feature => {
                if (feature) installFlowStep(feature);
            });
    });

    next();
};

exports.register.attributes = { name: 'geocodeio' };