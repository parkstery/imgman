// CSS cursor Data URLs for each tool
export const getToolCursor = (tool: string): string => {
  switch (tool) {
    case 'eraser': {
      // Eraser cursor: angled pink & white eraser with black border
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M4 15L13 6L18 11L9 20H4V15Z" fill="#F472B6" stroke="#000000" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M9 20L18 11L21 14L12 23H9V20Z" fill="#F3F4F6" stroke="#000000" stroke-width="1.5" stroke-linejoin="round"/>
        <line x1="13" y1="6" x2="18" y2="11" stroke="#000000" stroke-width="1.5"/>
      </svg>`;
      return `url('data:image/svg+xml;utf8,${encodeURIComponent(svg)}') 4 20, auto`;
    }

    case 'brush': {
      // Brush cursor: sleek paintbrush
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M3 21C4 20 6 19 8 16L19 5C19.5 4.5 20 3 19 2C18 1 16.5 1.5 16 2L5 13C2 15 1 17 0 21C1 21 2 21 3 21Z" fill="#3B82F6" stroke="#FFFFFF" stroke-width="1.2"/>
        <path d="M14 4L17 7" stroke="#FFFFFF" stroke-width="1.2"/>
      </svg>`;
      return `url('data:image/svg+xml;utf8,${encodeURIComponent(svg)}') 1 21, auto`;
    }

    case 'highlighter': {
      // Highlighter marker cursor
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M4 20L9 15L15 21L10 26L4 20Z" fill="#FBBF24" stroke="#000000" stroke-width="1.2"/>
        <path d="M9 15L17 7L21 11L13 19L9 15Z" fill="#F59E0B" stroke="#000000" stroke-width="1.2"/>
        <path d="M17 7L19 3L23 7L21 11L17 7Z" fill="#1F2937" stroke="#000000" stroke-width="1.2"/>
      </svg>`;
      return `url('data:image/svg+xml;utf8,${encodeURIComponent(svg)}') 4 20, auto`;
    }

    case 'eyedropper': {
      // Authentic pipette/eyedropper cursor with sharp sampling tip at (1, 26)
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28" fill="none">
        <path d="M18 6 C19.5 4.5 20.5 2.5 22.5 1.5 C24.5 0.5 26.5 2.5 25.5 4.5 C24.5 6.5 22.5 7.5 21 9 L18 6 Z" fill="#EF4444" stroke="#0F172A" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M16 8 L20 12 L18.5 13.5 L14.5 9.5 Z" fill="#94A3B8" stroke="#0F172A" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M14.5 9.5 L18.5 13.5 L9.5 22.5 L5.5 18.5 Z" fill="#F8FAFC" fill-opacity="0.9" stroke="#0F172A" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M8 20 L12 16 L14 18 L10 22 Z" fill="#3B82F6" fill-opacity="0.8"/>
        <path d="M5.5 18.5 L9.5 22.5 L3.5 25.5 L1.5 26.5 L2.5 24.5 Z" fill="#E2E8F0" stroke="#0F172A" stroke-width="1.5" stroke-linejoin="round"/>
        <circle cx="2" cy="26" r="1.5" fill="#EF4444" stroke="#FFFFFF" stroke-width="0.7"/>
      </svg>`;
      return `url('data:image/svg+xml;utf8,${encodeURIComponent(svg)}') 2 26, crosshair`;
    }

    case 'fill': {
      // Paint bucket cursor
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M19 11L11 3L3 11L11 19L19 11Z" fill="#E11D48" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M5 9L13 17" stroke="#FFFFFF" stroke-width="1.5"/>
        <path d="M20 16C20 18 18 19 18 21C18 22 19 23 20 23C21 23 22 22 22 21C22 19 20 18 20 16Z" fill="#E11D48" stroke="#FFFFFF" stroke-width="1"/>
      </svg>`;
      return `url('data:image/svg+xml;utf8,${encodeURIComponent(svg)}') 3 11, auto`;
    }

    case 'shape':
      return 'crosshair';

    case 'text':
      return 'text';

    case 'crop':
    case 'pen':
    case 'lasso':
      return 'crosshair';

    case 'pan':
      return 'grab';

    case 'select':
    default:
      return 'default';
  }
};
