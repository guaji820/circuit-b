'use strict';

const EventEmitter = require('events');
const asyncHooks = require('async_hooks');
const Breaker = require('./breaker');

const CircuitB = class CircuitB extends EventEmitter {
    constructor() {
        super();

        Object.defineProperty(this, 'registry', {
            value: new Map(),
        });

        const hooks = {
            init: (asyncId, type, triggerAsyncId, resource) => {
                if (type === 'TCPWRAP') {
                    process.nextTick(() => {
                        let breaker;

                        // Happens before connect
                        resource.owner.once('lookup', (err, address, family, host) => {
                            if (this.registry.has(host)) {
                                breaker = this.registry.get(host);

                                if (breaker.check()) {
                                    // Error type should be: CircuitBreakerOpenException
                                    resource.owner.destroy(new Error('CircuitBreakerOpenException'));
                                }
                            }
                        });

                        resource.owner.once('error', () => {
                            if (breaker) {
                                breaker.trip();
                            }
                        });

                        resource.owner.once('timeout', () => {
                            if (breaker) {
                                breaker.trip();
                            }
                        });

                        resource.owner.once('abort', () => {
                            if (breaker) {
                                breaker.trip();
                            }
                        });

                        resource.owner.once('end', () => {
                            if (breaker) {
                                const code = resource.owner._httpMessage.res.statusCode;
                                if (code >= 400 && code <= 499) {
                                    breaker.trip();
                                    return;
                                }

                                if (code >= 500 && code <= 599) {
                                    breaker.trip();
                                    return;
                                }

                                breaker.reset();
                            }
                        });
                    });
                }
            },
        };

        Object.defineProperty(this, 'hook', {
            value: asyncHooks.createHook(hooks),
        });
    }

    get [Symbol.toStringTag]() {
        return 'CircuitB';
    }

    enable() {
        this.hook.enable();
    }

    disable() {
        this.hook.disable();
    }

    set(host, options) {
        const breaker = new Breaker(host, options);
        breaker.on('open', (host) => {
            this.emit('open', host);
        });
        breaker.on('half_open', (host) => {
            this.emit('open', host);
        });
        breaker.on('close', (host) => {
            this.emit('close', host);
        });
        this.registry.set(host, breaker);
    }
};

module.exports = CircuitB;
