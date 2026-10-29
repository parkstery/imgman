import React from 'react';
import type { ShapeElement } from '../types';
import {
  getArrowHeadPath,
  getArrowHeadRotateDeg,
  getLineAngleDeg,
  getShortenedLineEndpoints,
  isArrowHeadFilled,
  lineCapToSvg,
  resolveArrowLinePoints,
} from '../utils/arrowUtils';

interface ArrowLineRendererProps {
  el: ShapeElement;
  isSelected: boolean;
  filterAttr?: string;
  isSelectOrElementTool: boolean;
  currentTool: string;
}

/**
 * PowerPoint-style arrow line renderer
 * Renders line with proper arrow heads that don't get pierced by the shaft
 */
export const ArrowLineRenderer: React.FC<ArrowLineRendererProps> = ({
  el,
  isSelected,
  filterAttr,
  isSelectOrElementTool,
  currentTool,
}) => {
  // Use points if available (new PowerPoint-style), otherwise fall back to width-based
  const { start: startPoint, end: endPoint } = resolveArrowLinePoints(
    el.width,
    el.height,
    el.points
  );
  
  // Get arrow configurations (with defaults for backward compatibility)
  const beginArrow = el.beginArrow || { type: 'none', size: 'medium' };
  const endArrow = el.endArrow || { type: 'none', size: 'medium' };
  
  // Calculate shortened endpoints to prevent shaft from poking through arrow heads
  const shortened = getShortenedLineEndpoints(
    startPoint.x,
    startPoint.y,
    endPoint.x,
    endPoint.y,
    el.strokeWidth,
    beginArrow.type,
    beginArrow.size,
    endArrow.type,
    endArrow.size
  );
  
  // Right-pointing heads: begin faces opposite the line so it is not disconnected
  const angle = getLineAngleDeg(startPoint.x, startPoint.y, endPoint.x, endPoint.y);
  const beginRotate = getArrowHeadRotateDeg(angle, 'begin');
  const endRotate = getArrowHeadRotateDeg(angle, 'end');
  
  // Stroke dash pattern
  const strokeDasharray =
    el.strokeDash === 'dashed' ? '8 6' : el.strokeDash === 'dotted' ? '3 4' : undefined;
  
  return (
    <>
      {/* Invisible wide hitbox for easy selection */}
      <line
        x1={startPoint.x}
        y1={startPoint.y}
        x2={endPoint.x}
        y2={endPoint.y}
        stroke="transparent"
        strokeWidth={Math.max(el.strokeWidth, 24)}
        pointerEvents={isSelectOrElementTool ? 'all' : 'none'}
        className={currentTool === 'select' ? 'cursor-pointer' : ''}
      />
      
      {/* Main line shaft (shortened to not poke through arrow heads) */}
      <line
        x1={shortened.startX}
        y1={shortened.startY}
        x2={shortened.endX}
        y2={shortened.endY}
        stroke={el.stroke}
        strokeWidth={el.strokeWidth}
        strokeLinecap={lineCapToSvg(el.lineCap)}
        strokeDasharray={strokeDasharray}
        opacity={el.opacity}
        filter={filterAttr}
        pointerEvents="none"
      />
      
      {/* Begin arrow head */}
      {beginArrow.type !== 'none' && (
        <path
          d={getArrowHeadPath(el.strokeWidth, beginArrow.type, beginArrow.size)}
          transform={`translate(${startPoint.x}, ${startPoint.y}) rotate(${beginRotate})`}
          fill={isArrowHeadFilled(beginArrow.type) ? el.stroke : 'none'}
          stroke={el.stroke}
          strokeWidth={isArrowHeadFilled(beginArrow.type) ? 0 : el.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={el.opacity}
          filter={filterAttr}
          pointerEvents="none"
        />
      )}
      
      {/* End arrow head */}
      {endArrow.type !== 'none' && (
        <path
          d={getArrowHeadPath(el.strokeWidth, endArrow.type, endArrow.size)}
          transform={`translate(${endPoint.x}, ${endPoint.y}) rotate(${endRotate})`}
          fill={isArrowHeadFilled(endArrow.type) ? el.stroke : 'none'}
          stroke={el.stroke}
          strokeWidth={isArrowHeadFilled(endArrow.type) ? 0 : el.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={el.opacity}
          filter={filterAttr}
          pointerEvents="none"
        />
      )}
    </>
  );
};
