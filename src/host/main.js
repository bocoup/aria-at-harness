/// <reference path="types.js" />

/**
 * @module host
 */

import { EventEmitter } from 'events';
import { agentMockOptions } from '../agent/cli.js';
import { createRunner } from '../agent/create-test-runner.js';
import { startJob } from '../shared/job.js';

import { HostMessage } from './messages.js';
import {
  addLogToTestPlan,
  setServerOptionsInTestPlan,
  addTestLogToTestPlan,
  addTestResultToTestPlan,
} from './plan-object.js';
import { getTimesOption } from '../shared/times-option.js';
import { AGENT_TEMPLATES } from '../agent/messages.js';

/**
 * @param {AriaATCIHost.Log} log
 * @param {Response} response
 */
const logUnsuccessfulHTTP = async (log, response) => {
  if (!response.ok) {
    const { status } = response;
    const body = await response.text().catch(() => 'Unknown error - unable to read response body.');

    log(HostMessage.REPORTING_ERROR, { status, body });
  }
};

/**
 * @param {object} options
 * @param {AriaATCIHost.Logger} options.logger
 * @param {AsyncIterable<AriaATCIHost.TestPlan>} options.plans
 * @param {AriaATCIHost.ReferenceFileServer} options.server
 * @param {AriaATCIAgent.TestRunner} options.runner
 * @param {AriaATCIHost.EmitPlanResults} options.emitPlanResults
 * @param {string} [options.callbackUrl]
 * @param {Record<string, string>} [options.callbackHeader]
 * @param {typeof fetch} options.fetch
 * @param options.agentMock
 * @param options.agentMockOpenPage
 * @param options.agentWebDriverUrl
 * @param options.agentWebDriverBrowser
 * @param options.agentAtDriverUrl
 */
export async function hostMain(options) {
  const {
    logger,
    plans,
    server,
    emitPlanResults,
    callbackUrl,
    callbackHeader,
    fetch,
    agentMock,
    agentMockOpenPage,
    agentWebDriverUrl,
    agentWebDriverBrowser,
    agentAtDriverUrl,
  } = options;
  const { log } = logger;
  log(HostMessage.START);

  await server.ready;
  log(HostMessage.SERVER_LISTENING, { url: server.baseUrl });

  const textDecoder = new TextDecoder();
  for await (let plan of plans) {
    const serverDirectory = server.addFiles(plan.files);
    log(HostMessage.ADD_SERVER_DIRECTORY, { url: serverDirectory.baseUrl });
    setServerOptionsInTestPlan(plan, { baseUrl: serverDirectory.baseUrl });

    const timesOption = getTimesOption(options);

    const emitter = new EventEmitter();
    const runner = await createRunner({
      log,
      abortSignal: new Promise(resolve => {
        emitter.on(HostMessage.STOP_RUNNER, () => resolve());
      }),
      timesOption,
      baseUrl: serverDirectory.baseUrl,
      mock: agentMockOptions({
        mock: agentMock,
        mockOpenPage: agentMockOpenPage,
      }),
      webDriverUrl: agentWebDriverUrl,
      webDriverBrowser: agentWebDriverBrowser,
      atDriverUrl: agentAtDriverUrl,
    });

    let lastCallbackRequest = Promise.resolve();

    const postCallbackWhenEnabled = body => {
      // ignore if not in callback mode
      if (!callbackUrl) return;
      const headers = {
        'Content-Type': 'application/json',
        ...(callbackHeader || {}),
      };
      const perTestUrl = callbackUrl.replace(
        ':testRowNumber',
        body.presentationNumber ?? body.testCsvRow
      );
      lastCallbackRequest = lastCallbackRequest.then(() =>
        fetch(perTestUrl, {
          method: 'post',
          body: JSON.stringify(body),
          headers,
        }).then(logUnsuccessfulHTTP.bind(null, log))
      );
    };

    for (const test of plan.tests) {
      const file = plan.files.find(({ name }) => name === test.filepath);
      const testSource = JSON.parse(textDecoder.decode(file.bufferData));

      const { presentationNumber, testId: testCsvRow } = testSource.info;

      const callbackBody = presentationNumber ? { presentationNumber } : { testCsvRow };

      log(HostMessage.START_TEST, { id: testSource.info.testId, title: testSource.info.title });
      const addLogtoPlan = message => {
        if (Object.keys(AGENT_TEMPLATES).includes(message.data.type)) {
          plan = addLogToTestPlan(plan, message);
          plan = addTestLogToTestPlan(plan, test);
        }
      };
      logger.emitter.on('message', addLogtoPlan);

      try {
        postCallbackWhenEnabled({ ...callbackBody, status: 'RUNNING' });

        const result = await runner.run(testSource, serverDirectory.baseUrl);

        const { capabilities, commands } = result;

        postCallbackWhenEnabled({
          ...callbackBody,
          capabilities,
          status: 'COMPLETED',
          responses: commands.map(({ output }) => output),
        });

        plan = addTestResultToTestPlan(plan, test.filepath, result);
      } catch (exception) {
        const error = `${exception.message ?? exception}`;
        log(HostMessage.TEST_ERROR, { error });
        postCallbackWhenEnabled({ ...callbackBody, error, status: 'ERROR' });
        await lastCallbackRequest;
        throw exception;
      } finally {
        logger.emitter.off('message', addLogtoPlan);
      }
    }

    server.removeFiles(serverDirectory);
    log(HostMessage.REMOVE_SERVER_DIRECTORY, { url: serverDirectory.baseUrl });

    await lastCallbackRequest;

    emitter.emit(HostMessage.STOP_RUNNER);

    await emitPlanResults(plan);
  }

  log(HostMessage.STOP_SERVER);
  await server.close();

  log(HostMessage.WILL_STOP);
}
