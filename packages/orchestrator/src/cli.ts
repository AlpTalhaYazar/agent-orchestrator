#!/usr/bin/env node

import { Command } from "commander";
import { registerRun } from "./commands/run.js";
import { registerPlan } from "./commands/plan.js";
import { registerContext } from "./commands/context.js";

const program = new Command();

program
  .name("agentpyre")
  .description("Iterative AI task orchestrator — plan, dispatch, collect, revise")
  .version("0.1.0");

registerRun(program);
registerPlan(program);
registerContext(program);

program.parseAsync();
