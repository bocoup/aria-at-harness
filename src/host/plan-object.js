/// <reference path="types.js" />

import * as arrayUtil from '../shared/array-util.js';

/**
 * @param {string} name
 * @returns {AriaATCIHost.TestPlan}
 */
export function blankTestPlan(name) {
  return {
    name,
    source: 'unknown',
    serverOptions: {
      baseUrl: {
        protocol: 'unknown',
        hostname: 'unknown',
        port: 0xffff,
        path: '',
      },
    },
    tests: [],
    files: [],
    log: [],
  };
}

/**
 * @param {TestPlanObject} testPlan
 * @param {TestPlanFile} file
 * @returns {TestPlanObject}
 */
export function addFileToTestPlan(testPlan, file) {
  file = validateTestPlanFile(file);
  return { ...testPlan, files: [...testPlan.files, file] };
}

/**
 * @param {TestPlanObject} testPlan
 * @param {TestPlanServerOptionsPartial} serverOptions
 * @returns {TestPlanObject}
 */
export function setServerOptionsInTestPlan(testPlan, serverOptions) {
  serverOptions = validateTestPlanServerOptionsPartial(serverOptions);
  return { ...testPlan, serverOptions: { ...testPlan.serverOptions, ...serverOptions } };
}

/**
 * @param {TestPlanObject} testPlan
 * @param {string} filepath
 * @returns {TestPlanObject}
 */
export function addTestToTestPlan(testPlan, filepath) {
  invariant(
    testPlan.files.find(file => file.name === filepath),
    () => `File ${filepath} does not exist in test.`
  );
  return { ...testPlan, tests: [...testPlan.tests, { filepath, log: [], results: [] }] };
}

/**
 * @param {TestPlanObject} testPlan
 * @param {*} log
 * @returns {TestPlanObject}
 */
export function addLogToTestPlan(testPlan, log) {
  return { ...testPlan, log: [...testPlan.log, log] };
}

/**
 * @param {AriaATCIHost.TestPlan} testPlan
 * @param {{filepath: string}} testFilepath
 * @returns {TestPlanObject}
 */
export function addTestLogToTestPlan(testPlan, { filepath: testFilepath }) {
  const test = testPlan.tests.find(({ filepath }) => filepath === testFilepath);
  return {
    ...testPlan,
    tests: arrayUtil.replace(testPlan.tests, test, {
      ...test,
      log: [...test.log, testPlan.log.length - 1],
    }),
  };
}

/**
 * @param {TestPlanObject} testPlan
 * @param {string} testFilepath
 * @param {*} result
 * @param {TestPlanObject}
 */
export function addTestResultToTestPlan(testPlan, testFilepath, result) {
  const test = testPlan.tests.find(({ filepath }) => filepath === testFilepath);
  return {
    ...testPlan,
    tests: arrayUtil.replace(testPlan.tests, test, { ...test, results: [...test.results, result] }),
  };
}

/**
 * @param {*} serverOptions
 * @returns {TestPlanServerOptionsPartial}
 */
function validateTestPlanServerOptionsPartial(serverOptions) {
  invariant(typeof serverOptions === 'object' && serverOptions !== null);
  for (const key of Object.keys(serverOptions)) {
    invariant(['baseUrl', 'files'].includes(key));
  }
  if (serverOptions.baseUrl) {
    validateTestPlanURL(serverOptions.baseUrl);
  }
  if (serverOptions.files) {
    invariant(
      typeof serverOptions.files === 'object' &&
        serverOptions.files !== null &&
        Array.isArray(serverOptions.files)
    );
    for (const file of serverOptions.files) {
      invariant(typeof file === 'string');
    }
  }
  return serverOptions;
}

/**
 * @param {*} url
 * @returns {AriaATCIShared.BaseURL}
 */
function validateTestPlanURL(url) {
  invariant(typeof url === 'object' && url !== null);
  for (const key of Object.keys(url)) {
    invariant(['protocol', 'hostname', 'port', 'pathname'].includes(key));
  }
  invariant(typeof url.protocol === 'string');
  invariant(typeof url.hostname === 'string');
  validatePort(url.port);
  invariant(typeof url.pathname === 'string');
  return url;
}

function validatePort(port) {
  invariant(typeof port === 'number', () => `typeof ${port} === 'number'`);
  invariant(port > 0 && port < 0x10000);
  return port;
}

/**
 * @param {*} file
 * @returns {TestPlanFile}
 */
function validateTestPlanFile(file) {
  invariant(typeof file === 'object' && file !== null);
  for (const key of Object.keys(file)) {
    invariant(['name', 'buffer'].includes(key));
  }
  invariant(typeof file.name === 'string');
  validateUint8Array(file.buffer);
  return file;
}

function validateUint8Array(buffer) {
  invariant(
    typeof buffer === 'object' && buffer !== null && buffer instanceof Uint8Array,
    () => `'${typeof buffer}' === 'object' && '${buffer.constructor.name}' === 'Uint8Array'`
  );
  return buffer;
}

function invariant(condition, message) {
  if (!condition) {
    if (message) {
      throw new Error(message());
    } else {
      throw new Error('assertion failed');
    }
  }
}
