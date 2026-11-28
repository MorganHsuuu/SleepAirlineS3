export type Activity = 'coffee' | 'meal' | 'walk' | 'transit' | 'rest';

export type Station = {
  id: string;
  owner: string;
  member: string;
  name: string;
  country: string;
  timezone: string | null;
  lat: number;
  lon: number;
  origin: [number, number];
  arrived: number;
};

export type Scene = {
  activity: Activity;
  location: string;
  object: string;
  action: string;
  light: string;
  emotion: string;
  next: string;
};

export type Message = {
  id: string;
  owner: string;
  member: string;
  kind: 'human' | 'ai';
  channel: 'group' | string;
  station?: string;
  replyTo?: string;
  addressedTo?: { kind: Message['kind']; member: string };
  text: string;
  created: number;
  scene?: Scene;
  image?: boolean;
  noteMessage?: boolean;
};

export type Job = {
  id: string;
  channel: Message['channel'];
  owner: string;
  station: string;
  type: 'story' | 'direct' | 'open' | 'cross' | 'image';
  due: number;
  source?: string;
  picture?: string;
  lease?: { token: string; until: number };
  tries?: number;
  queuedAt?: number;
};

export type Room = {
  messages: Message[];
  jobs: Job[];
  sharing: string[];
  sequence: number;
  cooldowns?: Record<string, number>;
  lastVisit?: Record<string, number>;
};

export const emptyRoom = (): Room => ({ messages: [], jobs: [], sharing: [], sequence: 0 });
export const activities = ['coffee', 'meal', 'walk', 'transit', 'rest'] as const;
