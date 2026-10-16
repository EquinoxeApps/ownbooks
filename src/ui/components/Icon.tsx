import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { colors } from '../tokens';

// Icons copied from docs/design/design.html (24×24 grid, round caps).
const stroked = {
  back: <Path d="M19 12H5M11 6l-6 6 6 6" />,
  plus: <Path d="M12 5v14M5 12h14" />,
  close: <Path d="M6 6l12 12M18 6L6 18" />,
  check: <Path d="M5 12.5l4.5 4.5L19 7.5" />,
  chevronRight: <Path d="M9 6l6 6-6 6" />,
  chevronDown: <Path d="M6 9l6 6 6-6" />,
  library: <Path d="M6 4v16M11 4v16M15 6l4 14" />,
  activity: (
    <>
      <Circle cx={12} cy={12} r={8.5} />
      <Path d="M12 7.5V12l3 2" />
    </>
  ),
  profile: (
    <>
      <Circle cx={12} cy={8.5} r={3.5} />
      <Path d="M5 20c1-3.5 4-5 7-5s6 1.5 7 5" />
    </>
  ),
  cloud: <Path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9.5a4 4 0 0 1 0 8.5z" />,
  cloudOff: (
    <>
      <Path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9.5a4 4 0 0 1 0 8.5z" />
      <Path d="M4 4l16 16" />
    </>
  ),
  phone: (
    <>
      <Rect x={7} y={3} width={10} height={18} rx={2} />
      <Path d="M11 17h2" />
    </>
  ),
  shield: <Path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />,
  bookmark: <Path d="M7 4h10v16l-5-4-5 4z" />,
  headphones: (
    <>
      <Path d="M5 15v-3a7 7 0 0 1 14 0v3" />
      <Rect x={3.5} y={14} width={4} height={6} rx={1.5} />
      <Rect x={16.5} y={14} width={4} height={6} rx={1.5} />
    </>
  ),
  book: <Path d="M12 6c-2-1.5-5-1.5-8 0v13c3-1.5 6-1.5 8 0 2-1.5 5-1.5 8 0V6c-3-1.5-6-1.5-8 0zM12 6v13" />,
  list: <Path d="M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01" />,
  mail: (
    <>
      <Rect x={3} y={5} width={18} height={14} rx={2} />
      <Path d="M3.5 6.5l8.5 6 8.5-6" />
    </>
  ),
} as const;

const filled = {
  play: <Path d="M7 4l13 8-13 8z" />,
  pause: <Path d="M6 4h4v16H6zM14 4h4v16h-4z" />,
  prevChapter: <Path d="M6 5h2v14H6zM20 5v14l-10-7z" />,
  nextChapter: <Path d="M16 5h2v14h-2zM4 5v14l10-7z" />,
  // Not in the design set: the book-row "details" button.
  more: (
    <>
      <Circle cx={5} cy={12} r={2} />
      <Circle cx={12} cy={12} r={2} />
      <Circle cx={19} cy={12} r={2} />
    </>
  ),
} as const;

export type IconName = keyof typeof stroked | keyof typeof filled;

type IconProps = {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
};

export function Icon({ name, size = 24, color = colors.ink, strokeWidth = 2.2 }: IconProps) {
  if (name in filled) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        {filled[name as keyof typeof filled]}
      </Svg>
    );
  }
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round">
      {stroked[name as keyof typeof stroked]}
    </Svg>
  );
}
