/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Wayland 基础组件库统一导出 / Wayland base components unified exports
 *
 * 提供所有基础组件和类型的统一导出入口
 * Provides unified export entry for all base components and types
 */

// ==================== 组件导出 / Component Exports ====================

export { default as WaylandModal } from './WaylandModal';
export { default as WaylandCollapse } from './WaylandCollapse';
export { default as WaylandSelect } from './WaylandSelect';
export { default as WaylandScrollArea } from './WaylandScrollArea';
export { default as WaylandSteps } from './WaylandSteps';

// ==================== 类型导出 / Type Exports ====================

// WaylandModal 类型 / WaylandModal types
export type {
  ModalSize,
  ModalHeaderConfig,
  ModalFooterConfig,
  ModalContentStyleConfig,
  WaylandModalProps,
} from './WaylandModal';
export { MODAL_SIZES } from './WaylandModal';

// WaylandCollapse 类型 / WaylandCollapse types
export type { WaylandCollapseProps, WaylandCollapseItemProps } from './WaylandCollapse';

// WaylandSelect 类型 / WaylandSelect types
export type { WaylandSelectProps } from './WaylandSelect';

// WaylandSteps 类型 / WaylandSteps types
export type { WaylandStepsProps } from './WaylandSteps';
