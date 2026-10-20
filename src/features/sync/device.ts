import * as Device from 'expo-device';
import { randomUUID } from 'expo-crypto';
import { Platform } from 'react-native';

import * as kv from '@/db/repositories/kv';
import type { Db } from '@/db/types';

import type { Device as SyncDevice } from './remote';

/**
 * This device as other devices see it ("Continue from <name>?"). The id is per account: a
 * device row belongs to one user, so a second account on the same phone gets its own.
 */
export async function thisDevice(db: Db, userId: string): Promise<SyncDevice> {
  const key = kv.userKey(userId, 'sync.deviceId');
  let id = await kv.getString(db, key);
  if (!id) {
    id = randomUUID();
    await kv.setString(db, key, id);
  }
  return { id, name: deviceName(), platform: Platform.OS === 'ios' ? 'ios' : 'android' };
}

function deviceName(): string {
  const name = Device.deviceName?.trim() || Device.modelName?.trim() || (Platform.OS === 'ios' ? 'iPhone' : 'Android');
  return name.slice(0, 100);
}
