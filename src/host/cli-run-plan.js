import path from 'path';
import { Readable } from 'stream';

import yargs from 'yargs';
import { pickAgentCliOptions } from '../agent/cli.js';
import { AgentMessage } from '../agent/messages.js';

import { AgentController as Agent } from './agent.js';
import { hostMain } from './main.js';
import { HostMessage, createHostLogger } from './messages.js';
import { plansFrom } from './plan-from.js';
import { Server } from './server.js';

export const command = 'run-plan [plan-files..]';

export const describe = 'Run test plans';

/**
 * @param {yargs} args
 */
export const builder = (args = yargs) =>
  args
    .positional('plan-files', { describe: 'Files in a test plan' })
    .options({
      quiet: {
        conflicts: ['debug', 'verbose'],
        describe: 'Disable all logging',
      },
      debug: {
        conflicts: ['quiet', 'verbose'],
        describe: 'Enable all logging',
      },
      verbose: {
        coerce(arg) {
          if (!arg) {
            return;
          }
          const messageValues = Object.values(HostMessage);
          const verbosity = arg.split(',');
          for (const name of verbosity) {
            if (!messageValues.includes(name)) {
              throw new Error(
                `--verbose '${arg}' contains unknown ids. It must be a comma separated list including: ${messageValues.join(
                  ', '
                )}`
              );
            }
          }
          return verbosity;
        },
        conflicts: ['debug', 'quiet'],
        describe: 'Enable a subset of logging messages',
        nargs: 1,
      },
      'tests-match': {
        describe: 'Files matching pattern in a test plan will be tested',
        default: '{,**/}test*.json',
        nargs: 1,
        type: 'string',
      },
      'plan-workingdir': {
        describe: 'Directory "plan-files" are relative to',
        default: '.',
        nargs: 1,
        type: 'string',
      },
      'plan-protocol': {
        choices: ['fork', 'api', 'auto'],
        default: 'auto',
        hidden: true,
      },
      'agent-protocol': {
        choices: ['fork', 'api', 'auto'],
        default: 'fork',
        hidden: true,
      },
      'agent-quiet': {
        conflicts: ['agent-debug', 'agent-verbose'],
        describe: 'Disable all logging',
        hidden: true,
      },
      'agent-debug': {
        conflicts: ['agent-quiet', 'agent-verbose'],
        describe: 'Enable all logging',
        hidden: true,
      },
      'agent-verbose': {
        coerce(arg) {
          if (!arg) {
            return;
          }
          const messageValues = Object.values(AgentMessage);
          const verbosity = arg.split(',');
          for (const name of verbosity) {
            if (!messageValues.includes(name)) {
              throw new Error(
                `--verbose must be a comma separated list including: ${Object.values(
                  AgentMessage
                ).join(', ')}`
              );
            }
          }
          return verbosity;
        },
        conflicts: ['agent-debug', 'agent-quiet'],
        describe: 'Enable a subset of logging messages',
        nargs: 1,
        hidden: true,
      },
      'agent-mock': {
        type: 'boolean',
        hidden: true,
      },
      'agent-mock-open-page': {
        choices: ['request', 'skip'],
        hidden: true,
      },
    })
    .showHidden('show-hidden')
    .middleware(verboseMiddleware)
    .middleware(mainMiddleware);

export const handler = argv => hostMain(argv);

async function verboseMiddleware(argv) {
  const { debug, quiet, verbose } = argv;

  let verbosity;
  if (debug) {
    verbosity = Object.values(HostMessage);
  } else if (quiet) {
    verbosity = [];
  } else {
    verbosity = Array.isArray(verbose)
      ? verbose
      : [
          HostMessage.START,
          HostMessage.UNCAUGHT_ERROR,
          HostMessage.WILL_STOP,
          HostMessage.SERVER_LISTENING,
          HostMessage.ADD_SERVER_DIRECTORY,
          HostMessage.REMOVE_SERVER_DIRECTORY,
        ];
  }

  argv.verbosity = verbosity;
}

function mainMiddleware(argv) {
  argv.planWorkingdir = path.resolve(argv.planWorkingdir);

  mainLoggerMiddleware(argv);
  mainTestPlanMiddleware(argv);
  mainServerMiddleware(argv);
  mainAgentMiddleware(argv);
  mainResultMiddleware(argv);
}

function mainLoggerMiddleware(argv) {
  const { stderr, verbosity } = argv;

  const logger = createHostLogger();
  argv.log = logger.log;

  logger.emitter.on('message', ({ data: { type }, text }) => {
    if (verbosity.includes(type)) {
      stderr.write(`${text}\n`);
    }
  });
}

function mainTestPlanMiddleware(argv) {
  const { log, testsMatch: testPattern, planProtocol, planWorkingdir, planFiles } = argv;

  if (!planFiles || planFiles.length === 0) {
    throw new Error(
      `'--plan-protocol ${planProtocol}' requires 'plan-files' argument to not be empty`
    );
  }

  const planInput = {
    protocol: planProtocol,
    workingdir: planWorkingdir,
    files: planFiles,
  };
  const planOptions = { log, testPattern };

  argv.plans = plansFrom(planInput, planOptions);
}

function mainServerMiddleware(argv) {
  const { log } = argv;

  argv.server = new Server({ log });
}

function mainAgentMiddleware(argv) {
  const {
    log,
    agentProtocol: protocol,
    agentDebug,
    agentQuiet,
    agentVerbose,
    agentMock,
    agentMockOpenPage,
  } = argv;

  argv.agent = new Agent({
    log,
    protocol,
    config: pickAgentCliOptions({
      debug: agentDebug,
      quiet: agentQuiet,
      verbose: agentVerbose,
      mock: agentMock,
      mockOpenPage: agentMockOpenPage,
    }),
  });
}

function mainResultMiddleware(argv) {
  const { stdout } = argv;

  /**
   * @param {AriaATCIHost.TestPlan} testPlan
   */
  argv.emitPlanResults = async ({ name, tests, log }) => {
    const result = {
      name,
      tests: tests.map(test => ({
        ...test,
        log: test.log.map(index => log[index]),
      })),
      log,
    };
    await new Promise(resolve =>
      Readable.from(JSON.stringify(result) + '\n')
        .on('end', resolve)
        .pipe(stdout, { end: false })
    );
  };
}
