/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Wayland Core left-rail sections, in display order.
 *
 * NOTE: Constitution is deliberately NOT here. The engine has no constitution
 * of its own (it is a Desktop concept), so the standalone Constitution entry
 * lives in the Desktop settings nav, not the Core rail.
 */
export type WCoreRailKey = 'overview' | 'services' | 'tools' | 'memory' | 'security' | 'profiles' | 'runtime';
