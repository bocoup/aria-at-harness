/// <reference path="../../node_modules/aria-at/types/aria-at-file.js" />
/// <reference path="../shared/types.js" />
/// <reference path="types.js" />

import { request } from 'http';
import { AgentMessage } from './messages.js';

/**
 * @module agent
 */

export class MockTestRunner {
  /**
   * @param {object} options
   * @param {AriaATCIShared.BaseURL} options.baseUrl
   * @param {AriaATCIAgent.Log} options.log
   * @param {AriaATCIAgent.MockOptions} options.mock
   */
  constructor({ baseUrl, log, mock: config }) {
    this.baseUrl = baseUrl;
    this.log = log;
    this.config = config;
  }

  async openPage(url) {
    if (this.config.openPage === 'request') {
      await new Promise((resolve, reject) =>
        request(url.toString(), res => {
          try {
            res
              .on('data', () => {})
              .on('error', reject)
              .setEncoding('utf8')
              .on('end', () => {
                res.statusCode < 400
                  ? resolve()
                  : reject(new Error(`request returned ${res.statusCode}`));
              });
          } catch (e) {
            reject(e);
          }
        })
          .on('error', reject)
          .end()
      );
    }

    this.log(AgentMessage.OPEN_PAGE, { url });
  }

  /**
   * @param {CollectedTestCommand} command
   * @param {CollectedTestAssertion} assertion
   */
  async runAssertion(command, assertion) {
    return {
      command: command.id,
      expectation: assertion.expectation,
      pass: await this.testAssertion(command, assertion),
    };
  }

  /**
   * @param {CollectedTestCommand} command
   * @param {CollectedTestAssertion} assertion
   */
  async testAssertion(command, assertion) {
    return true;
  }

  /**
   * @param {AriaATFile.CollectedTest} task
   */
  async run(task) {
    await this.openPage(
      new URL(
        `${this.baseUrl.pathname ? `${this.baseUrl.pathname}/` : ''}${task.target.referencePage}`,
        this.baseUrl
      )
    );
    return {
      testId: task.info.testId,
      results: await task.commands.reduce(
        async (carry, command) => [
          ...(await carry),
          ...(await task.assertions.reduce(
            async (carry, assertion) => [
              ...(await carry),
              await this.runAssertion(command, assertion),
            ],
            Promise.resolve([])
          )),
        ],
        Promise.resolve([])
      ),
    };
  }
}

/**
 * @typedef CollectedTestCommand
 * @property {string} id
 * @property {string} keystroke
 * @property {string} [extraInstructions]
 */

/**
 * @typedef CollectedTestAssertion
 * @property {number} priority
 * @property {string} expectation
 */
