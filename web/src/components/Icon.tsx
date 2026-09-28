/**
 * Inline icon set. Line icons at 1.75 stroke, sized by the `size` prop and
 * inheriting `currentColor`, so they sit correctly inside buttons and badges.
 */
export type IconName =
  | 'home' | 'plus' | 'clipboard' | 'list' | 'check' | 'chart' | 'settings' | 'bell'
  | 'search' | 'camera' | 'mic' | 'calendar' | 'user' | 'users' | 'train' | 'station'
  | 'alert' | 'clock' | 'file' | 'download' | 'chevron-right' | 'chevron-left'
  | 'chevron-down' | 'close' | 'filter' | 'refresh' | 'offline' | 'cloud-up'
  | 'shield' | 'repeat' | 'water' | 'info' | 'menu' | 'logout' | 'moon' | 'sun'
  | 'signature' | 'qr' | 'link' | 'trash' | 'edit' | 'send' | 'sort' | 'printer';

const PATHS: Record<IconName, string> = {
  home: 'M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5M9.5 20v-6h5v6',
  plus: 'M12 5v14M5 12h14',
  clipboard: 'M9 4h6v3H9zM7 5.5H5.5v15h13v-15H17M8.5 11h7M8.5 15h4',
  list: 'M4 6.5h16M4 12h16M4 17.5h11',
  check: 'M4.5 12.5 9 17l10.5-10.5',
  chart: 'M4 20V9M10 20V4M16 20v-7M22 20H2',
  settings: 'M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a1.9 1.9 0 0 1-3.8 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1A1.9 1.9 0 1 1 4.9 17l.1-.1A1.6 1.6 0 0 0 3.9 14H3.6a1.9 1.9 0 0 1 0-3.8h.2A1.6 1.6 0 0 0 5 7.4L4.9 7.3A1.9 1.9 0 1 1 7.6 4.6l.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5V3.2a1.9 1.9 0 0 1 3.8 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a1.9 1.9 0 0 1 0 3.8h-.2a1.6 1.6 0 0 0-1.4 1',
  bell: 'M18 8.5a6 6 0 1 0-12 0c0 7-2.5 8.5-2.5 8.5h17S18 15.5 18 8.5M13.7 21a2 2 0 0 1-3.4 0',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM20 20l-4.9-4.9',
  camera: 'M22 18.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h3l1.8-2.5h6.4L17 7.5h3a2 2 0 0 1 2 2ZM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  mic: 'M12 2.5a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0v-6a3 3 0 0 0-3-3M5.5 10.5v1a6.5 6.5 0 0 0 13 0v-1M12 18v3.5M8.5 21.5h7',
  calendar: 'M6.5 3v3M17.5 3v3M3.5 9.5h17M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V7A1.5 1.5 0 0 1 5 5.5Z',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  train: 'M7 3.5h10A2.5 2.5 0 0 1 19.5 6v9A2.5 2.5 0 0 1 17 17.5H7A2.5 2.5 0 0 1 4.5 15V6A2.5 2.5 0 0 1 7 3.5ZM4.5 10h15M9 14h.01M15 14h.01M7.5 17.5 5.5 21M16.5 17.5 18.5 21',
  station: 'M3 21h18M5.5 21V8l6.5-4.5L18.5 8v13M10 21v-5h4v5M9.5 11h5',
  alert: 'M12 3 2.5 20h19L12 3ZM12 9v5M12 17h.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7.5V12l3 2',
  file: 'M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8L14 3.5ZM13.5 3.5V8h5M8.5 13h7M8.5 16.5h4',
  printer: 'M7 8.5V3.5h10v5M7 17.5H5.5A1.5 1.5 0 0 1 4 16v-6a1.5 1.5 0 0 1 1.5-1.5h13A1.5 1.5 0 0 1 20 10v6a1.5 1.5 0 0 1-1.5 1.5H17M7 13.5h10v7H7Z',
  download: 'M12 3.5v12M7.5 11 12 15.5 16.5 11M4.5 20.5h15',
  'chevron-right': 'm9.5 5.5 6.5 6.5-6.5 6.5',
  'chevron-left': 'm14.5 5.5-6.5 6.5 6.5 6.5',
  'chevron-down': 'm5.5 9.5 6.5 6.5 6.5-6.5',
  close: 'M18 6 6 18M6 6l12 12',
  filter: 'M3.5 5.5h17l-6.5 8v6l-4 1.5v-7.5l-6.5-8Z',
  refresh: 'M20.5 12a8.5 8.5 0 1 1-2.6-6.1M20.5 4v5h-5',
  offline: 'M2 4.5 21.5 20M5 11a7 7 0 0 1 3-2.3M9 16.5a4 4 0 0 1 5.5-1M12 20h.01M18.5 12.5A7 7 0 0 0 15 8',
  'cloud-up': 'M12 16.5V9M9 11.5 12 8.5l3 3M6.5 18.5A4 4 0 0 1 6 10.6 6 6 0 0 1 17.8 9.5a3.6 3.6 0 0 1 .2 7.2',
  shield: 'M12 3 4.5 6v6c0 4.5 3 7.5 7.5 9 4.5-1.5 7.5-4.5 7.5-9V6L12 3ZM9 12l2 2 4-4',
  repeat: 'M17 2.5 20.5 6 17 9.5M20.5 6H7A3.5 3.5 0 0 0 3.5 9.5v1M7 21.5 3.5 18 7 14.5M3.5 18H17a3.5 3.5 0 0 0 3.5-3.5v-1',
  water: 'M12 2.7S5.5 10 5.5 14.3a6.5 6.5 0 0 0 13 0C18.5 10 12 2.7 12 2.7Z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 8h.01',
  menu: 'M4 7h16M4 12h16M4 17h16',
  logout: 'M15.5 16.5 20 12l-4.5-4.5M20 12H9M12.5 3.5H5.5A1.5 1.5 0 0 0 4 5v14a1.5 1.5 0 0 0 1.5 1.5h7',
  moon: 'M20.5 15.3A8.5 8.5 0 1 1 8.7 3.5a6.6 6.6 0 0 0 11.8 11.8Z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 1.5v2.5M12 20v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M1.5 12H4M20 12h2.5M4.2 19.8 6 18M18 6l1.8-1.8',
  signature: 'M3 17.5c3 0 3.5-11 6.5-11s1 8 3.5 8 2-5 4-5 1.5 3 4 3M3 21h18',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z',
  link: 'M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 1 0-5.7-5.7l-1 1M14 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 1 0 5.7 5.7l1-1',
  trash: 'M4 7h16M9.5 4.5h5M6.5 7v12A1.5 1.5 0 0 0 8 20.5h8a1.5 1.5 0 0 0 1.5-1.5V7M10 11v6M14 11v6',
  edit: 'M16.5 3.5 20.5 7.5 8 20H4v-4L16.5 3.5ZM14 6l4 4',
  send: 'M21.5 2.5 2.5 10l7 3 3 7 9-17.5ZM9.5 13l4-4',
  sort: 'M7 4v16M7 20l-3-3M17 20V4M17 4l3 3',
};

const FILLED: IconName[] = ['water', 'qr'];

export function Icon({
  name, size = 18, className, strokeWidth,
}: { name: IconName; size?: number; className?: string; strokeWidth?: number }) {
  const filled = FILLED.includes(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      fill={name === 'qr' ? 'currentColor' : 'none'}
      stroke={name === 'qr' ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth ?? (filled ? 1.6 : 1.75)}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export default Icon;
