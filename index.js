'use strict';

var isCallable = require('is-callable');
var isString = require('is-string');
var isArray = require('isarray');
var has = require('has');
var functionName = require('function.prototype.name');
var forEach = require('for-each');
var inspect = require('object-inspect');
var withOverrides = require('./withOverrides');
var withOverride = require('./withOverride');
var withGlobal = require('./withGlobal');
var checkWithName = require('./helpers/checkWithName');

var MODE_ALL = 'all';
var MODE_SKIP = 'skip';
var MODE_ONLY = 'only';

var beforeMethods = ['beforeAll', 'beforeEach'];
var afterMethods = ['afterAll', 'afterEach'];
var supportedMethods = [].concat(beforeMethods, afterMethods);

var privateInstances = [];
var getPrivateWrapper = function getPrivateWrapper(publicWrapper) {
	return privateInstances.find(function (privateWrapper) {
		return privateWrapper.getPublicWrapper() === publicWrapper;
	});
};

var assertIsJestWrapper = function assertIsJestWrapper(instance) {
	if (!instance || typeof instance !== 'object' || !(instance instanceof JestWrapper)) {
		throw new TypeError(inspect(instance) + ' must be a JestWrapper');
	}
	return instance;
};

/**
 * Validate that a descriptor is the correct format for extending JestWrapper.
 * Note: This converts hook values to arrays.
 * eg { beforeEach: function () {} } becomes { beforeEach: [function () {}] }
 */
var validateDescriptor = function validateDescriptor(descriptor) {
	forEach(supportedMethods, function (methodName) {
		if (methodName in descriptor) {
			if (!isArray(descriptor[methodName])) {
				descriptor[methodName] = [descriptor[methodName]];
			}
			forEach(descriptor[methodName], function (method) {
				if (!isCallable(method)) {
					throw new TypeError('wrapper method "' + method + '" must be a function, or array of functions, if present');
				}
			});
		}
	});
};

var applyMethods = function applyMethods(methodsToApply, descriptors) {
	forEach(descriptors, function (methods) {
		forEach(methodsToApply, function (method) {
			var functions = methods[method];
			if (functions) {
				forEach(functions, function (func) {
					global[method](func);
				});
			}
		});
	});
};

/**
 * This is a convenience class created for easier jest-wrap development, it is
 * private to prevent expanding the public api.
 */
var PrivateWrapper = function PrivateWrapper(publicWrapper) {
	this.publicWrapper = publicWrapper;
	this.descriptors = [];
	this.mode = MODE_ALL;
};

/**
 * This is the public version of the wrapper.
 * It's what gets returned from wrap() + all the public apis.
 */
var JestWrapper = function JestWrapper() {
	privateInstances.push(new PrivateWrapper(this));
};

Object.assign(PrivateWrapper.prototype, {
	describe: function describe(message, callback) {
		this.createAssertion('describe', message, this.wrappers, callback, this.mode);
	},

	it: function it(message, callback) {
		this.createAssertion('it', message, this.wrappers, callback, this.mode);
	},

	test: function test(message, callback) {
		this.createAssertion('test', message, this.wrappers, callback, this.mode);
	},

	extend: function extend(description, descriptor) {
		if (!isString(description) || description.length === 0) {
			throw new TypeError('a non-empty description string is required');
		}
		if (descriptor) {
			validateDescriptor(descriptor);
			descriptor.description = description;
			this.descriptors = this.descriptors.concat(descriptor);
		}

		return this;
	},

	use: function use(plugin) {
		if (!isCallable(plugin)) {
			throw new TypeError('plugin must be a function');
		}
		var withName = functionName(plugin);
		checkWithName(withName);

		var extraArguments = Array.prototype.slice.call(arguments, 1);
		var descriptorOrInstance = plugin.apply(this.getPublicWrapper(), extraArguments) || {};

		if (!(descriptorOrInstance instanceof JestWrapper)) {
			return this.extend(descriptorOrInstance.description, descriptorOrInstance);
		}

		return this;
	},

	createAssertion: function createAssertion(type, message, wrappers, block, mode) {
		var descriptors = this.descriptors;
		if (descriptors.length === 0) {
			throw new RangeError(inspect(type) + ' called with no wrappers defined');
		}
		var describeMsgs = descriptors.reduce(function descriptorReducer(descriptions, descriptor) {
			if (descriptor.description) {
				descriptions.push(descriptor.description);
			}
			return descriptions;
		}, []);

		var describeMsg = 'wrapped: ' + describeMsgs.join('; ') + ':';
		var describeMethod = global.describe;
		if (mode === MODE_SKIP) {
			describeMethod = global.describe.skip;
		} else if (mode === MODE_ONLY) {
			describeMethod = global.describe.only;
		}

		describeMethod(describeMsg, function () {
			applyMethods(beforeMethods, descriptors);
			global[type](message, block);
			applyMethods(['afterEach'], descriptors);
			applyMethods(['afterAll'], descriptors.reverse());
		});
	},

	only: function only() {
		this.mode = MODE_ONLY;
		return this;
	},

	skip: function only() {
		this.mode = MODE_SKIP;
		return this;
	},

	getPublicWrapper: function getPublicWrapper() {
		return this.publicWrapper;
	}
});

Object.assign(JestWrapper.prototype, {
	describe: function describe(message, callback) {
		assertIsJestWrapper(this);
		getPrivateWrapper(this).describe(message, callback);
	},
	it: function it(message, callback) {
		assertIsJestWrapper(this);
		getPrivateWrapper(this).it(message, callback);
	},
	test: function test(message, callback) {
		assertIsJestWrapper(this);
		getPrivateWrapper(this).test(message, callback);
	},
	extend: function extend(message, descriptors) {
		assertIsJestWrapper(this);
		return getPrivateWrapper(this).extend(message, descriptors).getPublicWrapper();
	},
	use: function use() {
		assertIsJestWrapper(this);
		var privateWrapper = getPrivateWrapper(this);
		return privateWrapper.use.apply(privateWrapper, arguments).getPublicWrapper();
	},
	only: function only() {
		return getPrivateWrapper(this).only().getPublicWrapper();
	},
	skip: function skip() {
		return getPrivateWrapper(this).skip().getPublicWrapper();
	}
});

/**
 * TODO - Comment and explain this... why is this the case? Also, these can
 * probably be programatically generated.
 */
JestWrapper.prototype.it.skip = function skip() {
	throw new SyntaxError('jest-wrap requires `.skip().it` rather than `it.skip`');
};

JestWrapper.prototype.it.only = function only() {
	throw new SyntaxError('jest-wrap requires `.only().it` rather than `it.only`');
};

JestWrapper.prototype.test.skip = function skip() {
	throw new SyntaxError('jest-wrap requires `.skip().test` rather than `test.skip`');
};

JestWrapper.prototype.test.only = function only() {
	throw new SyntaxError('jest-wrap requires `.only().test` rather than `test.only`');
};

JestWrapper.prototype.describe.skip = function skip() {
	throw new SyntaxError('jest-wrap requires `.skip().describe` rather than `describe.skip`');
};
JestWrapper.prototype.describe.only = function only() {
	throw new SyntaxError('jest-wrap requires `.only().describe` rather than `describe.only`');
};

var wrap = function wrap() {
	return new JestWrapper();
};

/**
 * Expose the list of supportedMethods [beforeAll, beforeEach, etc.], freeze
 * them to prevent mutation if possible.
 */
wrap.supportedMethods = isCallable(Object.freeze)
	? Object.freeze(supportedMethods)
	: /* istanbul ignore next */ supportedMethods.slice();

/**
 * Checks if a given withHelper function name is available.
 */
var isWithNameAvailable = function (name) {
	checkWithName(name); // This will throw if the supplied name is invalid.
	return !has(JestWrapper.prototype, name) || !isCallable(JestWrapper.prototype[name]);
};

/**
 * Register a new withHelper function for all JestWrappers.
 * Developers must pass a named function (function withName() {}), that follows
 * the with<Name> convention.
 */
wrap.register = function register(plugin) {
	var withName = functionName(plugin); // get the name of the passed function.
	if (!isWithNameAvailable(withName)) {
		// already registered
		return;
	}

	JestWrapper.prototype[withName] = function wrapper() {
		return this.use.apply(this, [plugin].concat(Array.prototype.slice.call(arguments)));
	};
};

/**
 * Removes a previously registered withHelper.
 */
wrap.unregister = function unregister(pluginOrWithName) {
	var withName = isCallable(pluginOrWithName) ? functionName(pluginOrWithName) : pluginOrWithName;
	if (isWithNameAvailable(withName)) {
		throw new RangeError('error: plugin "' + withName + '" is not registered.');
	}
	delete JestWrapper.prototype[withName];
};

wrap.register(withOverrides);
wrap.register(withOverride);
wrap.register(withGlobal);

module.exports = wrap;
