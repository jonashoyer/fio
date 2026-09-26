import { Copy, RotateCcw, Volume2 } from 'lucide-react-native';
import { Button, Card, Label, TextArea, TextField, Typography, useThemeColor } from 'heroui-native';
import { useState } from 'react';
import { View } from 'react-native';

import { clipboardService, voiceService } from '@/lib/fio/services';
import type { Artifact } from '@/lib/fio/types';

interface ArtifactCardProps {
  artifact: Artifact;
  onSave: (artifact: Artifact) => Promise<boolean>;
}

export function ArtifactCard({ artifact, onSave }: ArtifactCardProps) {
  const [draft, setDraft] = useState(artifact.text);
  const [notice, setNotice] = useState<string | null>(null);
  const [accent, muted] = useThemeColor(['accent', 'muted']);

  const save = async () => {
    if (draft === artifact.text) return;
    const now = new Date().toISOString();
    const saved = await onSave({
      ...artifact,
      text: draft,
      previous: { text: artifact.text, savedAt: now },
      updatedAt: now,
    });
    setNotice(saved ? 'Artifact saved.' : 'Artifact could not be saved.');
  };

  const undo = async () => {
    if (!artifact.previous) return;
    const previousText = artifact.previous.text;
    const saved = await onSave({
      ...artifact,
      text: previousText,
      previous: undefined,
      updatedAt: new Date().toISOString(),
    });
    if (saved) {
      setDraft(previousText);
      setNotice('Last artifact edit undone.');
    } else {
      setNotice('Artifact undo could not be saved.');
    }
  };

  const copy = async () => {
    try {
      await clipboardService.copyExact(artifact.text);
      setNotice('Copied exactly.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Copy failed.');
    }
  };

  const read = async () => {
    try {
      await voiceService.readArtifact(artifact);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Read aloud is unavailable.');
    }
  };

  return (
    <Card className="border-border bg-background gap-4 border p-4">
      <View className="flex-row items-center justify-between gap-3">
        <Typography className="text-foreground font-semibold">{artifact.title}</Typography>
        <Typography className="text-muted text-sm">Editable artifact</Typography>
      </View>
      <TextField>
        <Label className="sr-only">{artifact.title} text</Label>
        <TextArea
          value={draft}
          onChangeText={setDraft}
          onBlur={() => void save()}
          className="min-h-32 text-[18px] leading-7"
          accessibilityLabel={`${artifact.title} text`}
        />
      </TextField>
      <View className="flex-row flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          onPress={() => void save()}
          isDisabled={draft === artifact.text}
        >
          <Button.Label>Save</Button.Label>
        </Button>
        <Button
          size="sm"
          variant="tertiary"
          onPress={() => void undo()}
          isDisabled={!artifact.previous}
        >
          <RotateCcw color={muted} size={18} />
          <Button.Label>Undo edit</Button.Label>
        </Button>
        <Button size="sm" variant="tertiary" onPress={() => void copy()}>
          <Copy color={accent} size={18} />
          <Button.Label>Copy</Button.Label>
        </Button>
        <Button size="sm" variant="tertiary" onPress={() => void read()}>
          <Volume2 color={accent} size={18} />
          <Button.Label>Read aloud</Button.Label>
        </Button>
      </View>
      {notice ? <Typography className="text-muted text-sm">{notice}</Typography> : null}
    </Card>
  );
}
