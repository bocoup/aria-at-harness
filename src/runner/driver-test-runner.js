/// <reference path="../data/types.js" />
/// <reference path="../shared/types.js" />
/// <reference path="types.js" />

import { startJob } from '../shared/job.js';

import { ATDriver, ATKey, webDriverCodePoints } from './at-driver.js';
import { AgentMessage } from './messages.js';

/**
 * @module agent
 */

export class DriverTestRunner {
  /**
   * @param {object} options
   * @param {AriaATCIShared.BaseURL} options.baseUrl
   * @param {AriaATCIHost.Log} options.log
   * @param {BrowserDriver} options.browserDriver
   * @param {ATDriver} options.atDriver
   * @param {AriaATCIShared.timesOption} options.timesOption
   */
  constructor({ baseUrl, log, browserDriver, atDriver, timesOption }) {
    this.baseUrl = baseUrl;
    this.log = log;
    this.browserDriver = browserDriver;
    this.atDriver = atDriver;
    this.collectedCapabilities = this.getCapabilities();
    this.timesOption = timesOption;
  }

  async getCapabilities() {
    const { browserName, browserVersion } = await this.browserDriver.getCapabilities();
    const { atName, atVersion, platformName } = await this.atDriver.getCapabilities();
    return { atName, atVersion, browserName, browserVersion, platformName };
  }

  /**
   * @param {object} options
   * @param {URL} options.url
   * @param {string} options.referencePage
   */
  async openPage({ url, referencePage }) {
    await this.log(AgentMessage.OPEN_PAGE, { url });
    await this.browserDriver.navigate(url.toString());

    await this.browserDriver.documentReady();

    try {
      await this.browserDriver.clickWhenPresent(
        '.button-run-test-setup',
        this.timesOption.testSetup
      );
    } catch ({}) {
      await this.log(AgentMessage.NO_RUN_TEST_SETUP, { referencePage });
    }
  }

  /**
   * @param {import('./at-driver.js').ATKeySequence} sequence
   */
  async sendKeys(sequence) {
    await this.log(AgentMessage.PRESS_KEYS, { keys: sequence });
    await this.atDriver.sendKeys(sequence);
  }

  /**
   * @param {import('./at-driver.js').ATKeySequence} sequence
   * @param {string} desiredResponse
   */
  async pressKeysToToggleSetting(sequence, desiredResponse) {
    let unknownCollected = '';
    // there are 2 modes, so we will try pressing mode switch up to twice
    for (let triesRemain = 2; triesRemain > 0; triesRemain--) {
      const speechResponse = await this._collectSpeech(this.timesOption.modeSwitch, () =>
        this.sendKeys(sequence)
      );
      while (speechResponse.length) {
        const lastMessage = speechResponse.shift().trim();
        if (lastMessage.toLowerCase() === desiredResponse.toLowerCase()) {
          // our mode is correct, we are done
          return;
        }

        if (unknownCollected.length) unknownCollected += '\n';
        unknownCollected += lastMessage;
      }
    }
    throw new Error(
      `Unable to apply setting. Expected: "${desiredResponse}" Got: "${unknownCollected}"`
    );
  }

  /**
   * Used for v2 tests to ensure proper settings.
   *
   * @param {string} settings - "browseMode" "focusMode" for NVDA, "pcCursor" "virtualCursor"
   *                 for JAWS., "defaultMode" for others.
   */
  async ensureSettings(settings) {
    const { atName } = await this.collectedCapabilities;
    if (atName == 'NVDA') {
      const desiredResponse = { browsemode: 'Browse mode', focusmode: 'Focus mode' }[
        settings.toLowerCase()
      ];
      if (!desiredResponse) {
        throw new Error(`Unknown command settings for NVDA "${settings}"`);
      }

      // disable the "beeps" when switching focus/browse mode, forces it to speak the mode after switching
      await this.atDriver._send({
        method: 'nvda:settings.setSettings',
        params: { settings: [{ name: 'virtualBuffers.passThroughAudioIndication', value: false }] },
      });

      try {
        await this.pressKeysToToggleSetting(
          ATKey.sequence(ATKey.chord(ATKey.key('insert'), ATKey.key('space'))),
          desiredResponse
        );
      } finally {
        // turn the "beeps" back on so mode switches won't be spoken (default setting)
        await this.atDriver._send({
          method: 'nvda:settings.setSettings',
          params: {
            settings: [{ name: 'virtualBuffers.passThroughAudioIndication', value: true }],
          },
        });
      }
    } else if (atName == 'VoiceOver') {
      if (settings === 'quickNavOn' || settings === 'arrowQuickKeyNavOn') {
        await this.pressKeysToToggleSetting(
          ATKey.sequence(ATKey.chord(ATKey.key('left'), ATKey.key('right'))),
          'quick nav on'
        );
      } else if (settings === 'quickNavOff' || settings === 'arrowQuickKeyNavOff') {
        await this.pressKeysToToggleSetting(
          ATKey.sequence(ATKey.chord(ATKey.key('left'), ATKey.key('right'))),
          'quick nav off'
        );
      } else if (settings === 'singleQuickKeyNavOn') {
        await this.pressKeysToToggleSetting(
          ATKey.sequence(ATKey.chord(ATKey.key('control'), ATKey.key('option'), ATKey.key('q'))),
          'single-key quick nav on'
        );
      } else if (settings === 'singleQuickKeyNavOff') {
        await this.pressKeysToToggleSetting(
          ATKey.sequence(ATKey.chord(ATKey.key('control'), ATKey.key('option'), ATKey.key('q'))),
          'single-key quick nav off'
        );
      } else if (settings !== 'defaultMode') {
        throw new Error(`Unrecognized setting for VoiceOver: ${settings}`);
      }
      return;
    } else if (!atName) {
      return;
    } else {
      throw new Error(`Unable to ensure proper settings. Unknown atName ${atName}`);
    }
  }

  /**
   * Used for v1 aria-at tests, "reading" and "interaction" map to various settings based on AT.
   * @param {"reading" | "interaction"} mode
   */
  async ensureMode(mode) {
    const { atName } = await this.collectedCapabilities;
    if (atName === 'NVDA') {
      await this.ensureSettings(mode.toLowerCase() === 'reading' ? 'browseMode' : 'focusMode');
      return;
    } else if (atName === 'VoiceOver') {
      return;
    } else if (!atName) {
      return;
    }
    throw new Error(`Unable to ensure proper mode. Unknown atName ${atName}`);
  }

  /**
   * @param {AriaATCIData.CollectedTest} test
   */
  async run(test) {
    const capabilities = await this.collectedCapabilities;
    await this.log(AgentMessage.CAPABILITIES, { capabilities });

    await this.log(AgentMessage.START_TEST, { id: test.info.testId, title: test.info.task });

    await this.log(AgentMessage.OPEN_PAGE, { url: 'about:blank' });
    await this.browserDriver.navigate('about:blank');

    const commandsOutput = [];
    const results = [];

    for (const command of test.commands) {
      const { value: validCommand, errors } = validateKeysFromCommand(command);

      if (validCommand) {
        await this._collectSpeech(this.timesOption.afterNav, () =>
          this.openPage({
            url: this._appendBaseUrl(test.target.referencePage),
            referencePage: test.target.referencePage,
          })
        );

        if (command.settings) {
          // Ensure AT is in proper mode for tests.  V2 tests define "settings" per command.
          await this.ensureSettings(command.settings);
        } else if (test.target?.mode) {
          // V1 tests define a "mode" of "reading" or "interaction" on the test.target
          await this.ensureMode(test.target.mode);
        }

        const spokenOutput = await this._collectSpeech(this.timesOption.afterKeys, () =>
          this.sendKeys(atKeysFromCommand(validCommand))
        );

        await this._collectSpeech(this.timesOption.afterNav, async () => {
          await this.log(AgentMessage.OPEN_PAGE, { url: 'about:blank' });
          await this.browserDriver.navigate('about:blank');
        });

        commandsOutput.push({
          command: command.id,
          output: spokenOutput.join('\n'),
        });

        for (const assertion of test.assertions) {
          results.push({
            command: command.id,
            expectation: assertion.expectation || assertion.assertionStatement,
            pass: true,
          });
        }
      } else {
        await this.log(AgentMessage.INVALID_KEYS, { command, errors });

        commandsOutput.push({
          command: command.id,
          errors,
        });

        for (const assertion of test.assertions) {
          results.push({
            command: command.id,
            expectation: assertion.expectation,
            pass: false,
          });
        }
      }
    }

    const { testId, presentationNumber } = test.info;

    return {
      testId,
      presentationNumber,
      capabilities,
      commands: commandsOutput,
      results,
    };
  }

  /**
   * @param {number} debounceDelay
   * @param {function(): Promise<void>} asyncOperation
   * @returns {Promise<string[]>}
   */
  async _collectSpeech(debounceDelay, asyncOperation) {
    let spoken = [];
    const speechJob = startJob(async signal => {
      for await (const speech of signal.cancelable(this.atDriver.speeches())) {
        spoken.push(speech);
        this.log(AgentMessage.SPEECH_EVENT, { spokenText: speech });
      }
    });

    await asyncOperation();

    let i = 0;
    do {
      i = spoken.length;
      await timeout(debounceDelay);
    } while (i < spoken.length);

    await speechJob.cancel();

    return spoken;
  }

  _appendBaseUrl(pathname) {
    // protocol ends with a ':' and pathname starts with a '/'
    const base = `${this.baseUrl.protocol}://${this.baseUrl.hostname}:${this.baseUrl.port}${this.baseUrl.pathname}`;
    const newPath = `${this.baseUrl.pathname ? `${this.baseUrl.pathname}/` : ''}${pathname}`;
    return new URL(newPath, base);
  }
}

export function validateKeysFromCommand(command) {
  const errors = [];
  for (let { id } of command.keypresses) {
    id = id
      // PAGE_DOWN and PAGE_UP are the only commands that have the extra _ inside a key
      .replace(/(PAGE)_(DOWN|UP)/, '$1$2')
      // + is used to connect keys that are pressed simultaneously in v2 tests
      .replace('+', '_')
      // `UP_ARROW`, `DOWN_ARROW`, etc are sent as `up`, `down`, etc
      .replace(/_ARROW/g, '');
    if (/\//.test(id)) {
      errors.push(`'${id}' cannot contain '/'.`);
    }
    if (/[()]/.test(id)) {
      errors.push(`'${id}' cannot contain '(' or ')'.`);
    }
    if (/\bor\b/.test(id)) {
      errors.push(`'${id}' cannot contain 'or'.`);
    }
    if (/\bfollowed\b/.test(id)) {
      errors.push(`'${id}' cannot contain 'followed' or 'followed by'.`);
    }
    for (const part of id.split(/[_+,]/)) {
      // Some old test plans have keys that contain indications of unspecified
      // instructions ('/') or additional instructions that are not standardized
      // in test plans. These keys should be updated to be separate commands or
      // use a standardized approach.

      if (part.length != 1 && !webDriverCodePoints[part.toUpperCase()]) {
        errors.push(
          `'${part}' of '${id}' is not a recognized key - use single characters or "Normalized" values from https://w3c.github.io/webdriver/#keyboard-actions`
        );
      }
    }
  }

  if (errors.length > 0) {
    return { errors };
  }
  return { value: command };
}

/**
 * @param {CommandKeystroke} command
 */
export function atKeysFromCommand(command) {
  return ATKey.sequence(
    ...command.keypresses.map(({ id }) =>
      ATKey.chord(
        ...id
          .replace(/(PAGE)_(DOWN|UP)/, '$1$2')
          .replace(/\+/g, '_') // + is used to connect keys that are pressed simultaneously in v2 tests
          .split('_')
          .map(key => key.trim().toLowerCase())
          // `up arrow`, `down arrow`, etc are sent as `up`, `down`, etc
          .map(key => key.replace(/\s?arrow\s?/g, ''))
          // remove whitespace for keys like 'page up'
          .map(key => key.replace(/\s/g, ''))
          .map(key => ATKey.key(key.toLowerCase()))
      )
    )
  );
}

async function timeout(delay) {
  await new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * @typedef CommandKeystroke
 * @property {string} id
 * @property {string} keystroke
 * @property {object[]} keypresses
 * @property {string} keypresses.id
 * @property {string} keypresses.keystroke
 */
