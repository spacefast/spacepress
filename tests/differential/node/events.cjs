const Events = require("events");
const { EventEmitter } = require("node:events");

exports.eventClassIdentity = function () {
  return Events === Events.EventEmitter && Events === EventEmitter && new Events() instanceof EventEmitter;
};
