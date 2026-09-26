import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const CREDENTIAL_KEY = 'fio.installation.credential.v1';
const DEVICE_ID_KEY = 'fio.installation.device-id.v1';
const SYNC_TOKEN_KEY = 'fio.sync-token.v1';

export interface InstallationIdentity {
  deviceId: string;
  credential: string;
}

export interface InstallationCredentialStore {
  getIdentity(): Promise<InstallationIdentity | null>;
  saveIdentity(identity: InstallationIdentity): Promise<void>;
  getSyncToken(): Promise<string | null>;
  saveSyncToken(token: string): Promise<void>;
}

class NativeInstallationCredentialStore implements InstallationCredentialStore {
  async getIdentity(): Promise<InstallationIdentity | null> {
    const [deviceId, credential] = await Promise.all([
      SecureStore.getItemAsync(DEVICE_ID_KEY),
      SecureStore.getItemAsync(CREDENTIAL_KEY),
    ]);
    return deviceId && credential ? { deviceId, credential } : null;
  }

  async saveIdentity(identity: InstallationIdentity): Promise<void> {
    const options = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };
    await SecureStore.setItemAsync(DEVICE_ID_KEY, identity.deviceId, options);
    await SecureStore.setItemAsync(CREDENTIAL_KEY, identity.credential, options);
  }

  getSyncToken(): Promise<string | null> {
    return SecureStore.getItemAsync(SYNC_TOKEN_KEY);
  }

  saveSyncToken(token: string): Promise<void> {
    return SecureStore.setItemAsync(SYNC_TOKEN_KEY, token, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
  }
}

class UnsupportedCredentialStore implements InstallationCredentialStore {
  private fail(): never {
    throw new Error('Private installation credentials require the native Fio development build.');
  }
  getIdentity(): Promise<InstallationIdentity | null> {
    return Promise.reject(this.fail());
  }
  saveIdentity(_identity: InstallationIdentity): Promise<void> {
    return Promise.reject(this.fail());
  }
  getSyncToken(): Promise<string | null> {
    return Promise.reject(this.fail());
  }
  saveSyncToken(_token: string): Promise<void> {
    return Promise.reject(this.fail());
  }
}

export const installationCredentialStore: InstallationCredentialStore =
  Platform.OS === 'web'
    ? new UnsupportedCredentialStore()
    : new NativeInstallationCredentialStore();
