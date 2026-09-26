import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import type { Attachment, AttachmentService } from './types';

function extensionFor(asset: ImagePicker.ImagePickerAsset): string {
  const fromName = asset.fileName?.split('.').pop();
  if (fromName && /^[a-z0-9]+$/i.test(fromName)) return fromName.toLowerCase();
  return asset.mimeType === 'image/png' ? 'png' : 'jpg';
}

export class DurableImageAttachmentService implements AttachmentService {
  async pickImage(): Promise<Attachment | null> {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      base64: Platform.OS === 'web',
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return null;

    const asset = result.assets[0];
    const id = Crypto.randomUUID();
    const mimeType = asset.mimeType ?? 'image/jpeg';
    let uri: string;

    if (Platform.OS === 'web') {
      if (!asset.base64) throw new Error('This image could not be kept for the next visit.');
      uri = `data:${mimeType};base64,${asset.base64}`;
    } else {
      const attachmentDirectory = new Directory(Paths.document, 'fio-attachments');
      attachmentDirectory.create({ idempotent: true, intermediates: true });
      const destination = new File(attachmentDirectory, `${id}.${extensionFor(asset)}`);
      await new File(asset.uri).copy(destination);
      uri = destination.uri;
    }

    return {
      id,
      kind: 'image',
      name: asset.fileName ?? 'Reference image',
      uri,
      mimeType,
      createdAt: new Date().toISOString(),
    };
  }

  async remove(attachment: Attachment): Promise<void> {
    if (Platform.OS === 'web' || !attachment.uri.startsWith('file:')) return;
    const file = new File(attachment.uri);
    if (file.exists) file.delete();
  }
}

export const attachmentService: AttachmentService = new DurableImageAttachmentService();
