'use strict';

const joi = require('joi');
const _ = require('lodash');
const Transform = require('stream').Transform;
const es = require('ent-streams');
const request = require('request');

const schema = joi.object({
    address: joi.string().required()
});

/**
 * Converts address field into full address field for storing results
 * @param field
 */
const fullAddressField = field => `${field}_full`;

/**
 * Stream for reading cached address info
 */
class CacheReader extends Transform {

    constructor (client, addressField) {
        super({ objectMode: true });
        this.addressField = addressField;
        this.fullAddressField = fullAddressField(addressField);
        this.client = client;
    }

    _transform (batch, enc, done) {
        // the addresses that need coding
        const addressed = batch
            .map(r => _.set(r, '__requiresgeocode', !!r[this.addressField]))
            .filter(r => r.__requiresgeocode);

        // cached address commands
        const commands = addressed.map(r => ['hget', 'geocodeio', r[this.addressField]]);

        if (!commands.length) return done(null, batch);

        this.client.multi(commands)
            .exec((err, results) => {
                if (err) return done(err);
                results.forEach((r, i) => {
                    // we've seen this address before. mark it
                    const hit = JSON.parse(r);
                    if (!hit) return;

                    addressed[i].location = hit.location;
                    addressed[i][this.fullAddressField] = hit.address;
                    _.each(hit.address, (v, f) => {
                        _.set(addressed[i], `${this.addressField}_${f}`, v);
                    });
                    addressed[i].__requiresgeocode = false;
                });
                done(null, batch);
            });
    }
}

/**
 * The actual geocoding stream
 */
class Geocoder extends Transform {
    constructor (key, addressField) {
        super({ objectMode: true });
        this.key = key;
        this.addressField = addressField;
        this.fullAddressField = fullAddressField(addressField);
    }

    applyAddressInfo (records, result) {
        if (!result.results || !result.results.length) return;

        result.results.forEach((r, i) => {
            // stamp as visited and eligible for caching
            records[i].__geocoded = true;

            const geodata = r.response.results[0];

            if (!geodata) return;

            records[i][this.fullAddressField] = geodata.address_components;

            if (geodata.location) records[i].location = { lat: geodata.location.lat, lon: geodata.location.lng };

            _.each(geodata.address_components, (v, f) => {
                _.set(records[i], `${this.addressField}_${f}`, v);
            });
        });
    }

    _transform (batch, enc, done) {
        const recs = batch.filter(r => r.__requiresgeocode);

        // nothing to process
        if (!recs) return done(null, batch);

        request({
            url: `https://api.geocod.io/v1/geocode?api_key=${this.key}`,
            method: 'post',
            body: _.pluck(recs, this.addressField),
            json: true
        }, (err, message, result) => {
            if (err) {
                console.error(err);
                return done(null, batch);
            }

            this.applyAddressInfo(recs, result);

            done(null, batch);
        });
    }
}

/**
 * Writes addresses to cache
 */
class CacheWriter extends Transform {
    constructor (client, addressField) {
        super({ objectMode: true });

        this.client = client;
        this.addressField = addressField;
        this.fullAddressField = fullAddressField(addressField);
    }

    _transform (batch, enc, done) {
        const commands = batch.filter(r => r.__geocoded)
            .map(r => ['hmset', 'geocodeio', r[this.addressField], JSON.stringify({
                location: r.location,
                address: r[this.fullAddressField]
            })]);

        batch.forEach(r => {
            delete r.__geocoded;
            delete r.__requiresgeocode;
        });

        this.client.multi(commands)
            .exec((err) => {
                if (err) return done(err);
                else done(null, batch);
            });
    }
}

module.exports = function (server, key) {
    return {
        id: 'geocode',
        name: 'GeoCode',
        group: 'Add Field',
        description: 'Geocode your data',
        image: '/assets/geocodio/images/zip2geo.svg',
        color: 'red',
        validate: function (opts) {
            return joi.attempt(opts, schema);
        },
        post: function (qr, opts) {
            qr.field('location').type('geo_point').label('Location');
            qr.field(opts.address + '_full').type('object');
        },
        through: function (stream, opts) {
            const client = server.plugins['hapi-redis'].client;

            return es.pipelineBuilder(stream)
                .pipe(es.batch(1000))
                .pipe(new CacheReader(client, opts.address))
                .pipe(new Geocoder(key, opts.address))
                .pipe(new CacheWriter(client, opts.address))
                .pipe(new Transform({
                    objectMode: true,
                    transform: function (chunk, enc, done) {
                        chunk.forEach(r => this.push(r));
                        done();
                    }
                }))
                .build();
        },
        editor: {
            formly: [{
                key: 'address',
                type: 'formly-flow-field-select',
                templateOptions: {
                    label: 'Address Field'
                }
            }]
        },
        labelExpr: '{{ data.address }}'
    };
};