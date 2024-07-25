/// <reference path="../shared/types.js" />
/// <reference path="types.js" />

/**
 * @module agent
 */

import { MockTestRunner } from './mock-test-runner.js';
import { DriverTestRunner } from './driver-test-runner.js';
import { createBrowserDriver } from './browser-driver/create.js';
import { createATDriver } from './at-driver.js';
import { AgentMessage } from './messages.js';

/**
 * @param {object} options
 * @param {{hostname: string, port: number | string, pathname: string}} options.atDriverUrl
 * @param {AriaATCIShared.BaseURL} options.baseUrl
 * @param {AriaATCIHost.Log} options.log
 * @param {Promise<void>} options.abortSignal
 * @param {AriaATCIAgent.MockOptions} [options.mock]
 * @param {AriaATCIAgent.Browser} [options.webDriverBrowser]
 * @param {AriaATCIShared.timesOption} options.timesOption
 * @param {{toString: function(): string}} options.webDriverUrl
 * @returns {Promise<AriaATCIAgent.TestRunner>}
 */
export async function createRunner(options) {
  // stubbing this out for now
  const abortSignal = options.abortSignal;

  if (options.mock) {
    return new MockTestRunner({ mock: options.mock, ...options });
  }
  await new Promise(resolve => setTimeout(resolve, 1000));
  const { timesOption } = options;
  const [browserDriver, atDriver] = await Promise.all([
    createBrowserDriver({
      url: options.webDriverUrl,
      browser: options.webDriverBrowser,
      abortSignal: options.abortSignal,
      timesOption,
    }).catch(cause => {
      throw new Error('Error initializing browser driver', { cause });
    }),
    createATDriver({
      url: options.atDriverUrl,
      abortSignal,
      log: console.log,
    }).catch(cause => {
      throw new Error('Error connecting to at-driver', { cause });
    }),
  ]);
  return new DriverTestRunner({ ...options, browserDriver, atDriver });
}
