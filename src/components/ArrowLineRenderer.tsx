import React from 'react';
import type { ShapeElement } from '../types';
import {
  getArrowHeadPath,
  getShortenedLineEndpoints,
  isArrowHeadFilled,
  lineCapToSvg,
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
  const hasPoints = el.points && el.points.length >= 2;
  const startPoint = hasPoints ? el.points[0] : { x: 0, y: el.height / 2 };
  const endPoint = hasPoints ? el.points[el.points.length - 1] : { x: el.width, y: el.height / 2 };
  
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
  
  // Calculate angle for arrow heads
  const dx = endPoint.x - startPoint.x;
  const dy = endPoint.y - startPoint.y;
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  
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
          transform={`translate(${startPoint.x}, ${startPoint.y}) rotate(${angle})`}
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
          transform={`translate(${endPoint.x}, ${endPoint.y}) rotate(${angle})`}
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
