import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

interface FioBirdProps {
  size?: 24 | 48;
}

export function FioBird({ size = 24 }: FioBirdProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      accessibilityRole="image"
      accessibilityLabel="Fio bird"
    >
      <Rect width={512} height={512} fill="#F8F7F4" />
      <G transform="translate(-85 -30) scale(1.25)">
        <Path
          d="M 161,328 C 164,285 182,258 204,236 C 219,220 214,208 218,177 C 223,134 253,111 284,119 C 316,126 337,152 338,181 L 384,202 L 337,217 C 332,249 312,270 282,286"
          fill="none"
          stroke="#4338CA"
          strokeWidth={30}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Circle cx={291} cy={172} r={12} fill="#4338CA" />
      </G>
    </Svg>
  );
}
