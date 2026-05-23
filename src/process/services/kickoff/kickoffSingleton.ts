/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { cronService } from '@process/services/cron/cronServiceSingleton';
import { SqliteConversationRepository } from '@process/services/database/SqliteConversationRepository';
import { SqliteTeamRepository } from '@process/team/repository/SqliteTeamRepository';
import { SignalCollector } from './SignalCollector';
import { SuggestionEngine } from './SuggestionEngine';

const conversationRepo = new SqliteConversationRepository();
const teamRepo = new SqliteTeamRepository();

const signalCollector = new SignalCollector(conversationRepo, cronService, teamRepo);
export const kickoffEngine = new SuggestionEngine(signalCollector);
