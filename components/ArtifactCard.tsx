import { Copy, RotateCcw, Volume2 } from 'lucide-react-native';
import { Button, Card, Label, TextArea, TextField, Typography, useThemeColor } from 'heroui-native';
import { useRef, useState } from 'react';
import { View } from 'react-native';

import { clipboardService } from '@/lib/fio/services';
import type { Artifact, VoiceArtifactSnapshot } from '@/lib/fio/types';

interface ArtifactCardProps {
  artifact: Artifact;
  isSelected: boolean;
  onSelect: (artifactId: string) => void;
  onRead: (snapshot: VoiceArtifactSnapshot) => Promise<void>;
  onSave: (artifact: Artifact) => Promise<boolean>;
}

export function ArtifactCard({
  artifact,
  isSelected,
  onSelect,
  onRead,
  onSave,
}: ArtifactCardProps) {
  const [draft, setDraft] = useState(artifact.text);
  const [notice, setNotice] = useState<string | null>(null);
  const [frozenReadText, setFrozenReadText] = useState<string | null>(null);
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const [accent, muted] = useThemeColor(['accent', 'muted']);

  const save = () => {
    if (draft === artifact.text) return Promise.resolve(true);
    if (savePromiseRef.current) return savePromiseRef.current;

    const now = new Date().toISOString();
    const request = onSave({
      ...artifact,
      text: draft,
      previous: { text: artifact.text, savedAt: now },
      updatedAt: now,
    })
      .then((saved) => {
        setNotice(saved ? 'Artifact saved.' : 'Artifact could not be saved.');
        return saved;
      })
      .catch(() => {
        setNotice('Artifact could not be saved.');
        return false;
      });
    savePromiseRef.current = request;
    void request.finally(() => {
      if (savePromiseRef.current === request) savePromiseRef.current = null;
    });
    return request;
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
    const snapshot = draft;
    try {
      if (!(await save())) {
        setNotice('Copy stopped because the latest edit was not saved.');
        return;
      }
      await clipboardService.copyExact(snapshot);
      setNotice('Copied exactly.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Copy failed.');
    }
  };

  const read = async () => {
    const snapshot = { id: artifact.id, text: artifact.text };
    setFrozenReadText(snapshot.text);
    try {
      await onRead(snapshot);
      setNotice('Reading the frozen artifact text.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Read aloud is unavailable.');
    }
  };

  return (
    <Card
      className={
        isSelected
          ? 'border-accent bg-artifact-selected gap-4 border p-4'
          : 'border-border bg-surface gap-4 border p-4'
      }
    >
      <View className="flex-row items-center justify-between gap-3">
        <Typography className="text-foreground font-semibold">{artifact.title}</Typography>
        <Button
          size="md"
          variant={isSelected ? 'secondary' : 'tertiary'}
          onPress={() => onSelect(artifact.id)}
          accessibilityLabel={`${isSelected ? 'Selected' : 'Select'} ${artifact.title}`}
        >
          <Button.Label>{isSelected ? 'Selected' : 'Select'}</Button.Label>
        </Button>
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
      {isSelected ? (
        <View className="flex-row flex-wrap gap-2">
          <Button
            size="md"
            variant="tertiary"
            onPress={() => void undo()}
            isDisabled={!artifact.previous}
            accessibilityLabel="Undo artifact edit"
          >
            <RotateCcw color={muted} size={18} />
            <Button.Label>Undo edit</Button.Label>
          </Button>
          <Button
            size="md"
            variant="tertiary"
            onPress={() => void copy()}
            accessibilityLabel="Copy artifact exactly"
          >
            <Copy color={accent} size={18} />
            <Button.Label>Copy</Button.Label>
          </Button>
          <Button
            size="md"
            variant="tertiary"
            onPress={() => void read()}
            accessibilityLabel="Read artifact aloud"
          >
            <Volume2 color={accent} size={18} />
            <Button.Label>Read aloud</Button.Label>
          </Button>
        </View>
      ) : null}
      {isSelected && frozenReadText !== null ? (
        <Card className="bg-background-secondary gap-1 p-3">
          <Typography className="text-muted text-sm font-medium">Frozen read-aloud text</Typography>
          <Typography className="text-foreground text-base leading-6">{frozenReadText}</Typography>
        </Card>
      ) : null}
      {notice ? <Typography className="text-muted text-sm">{notice}</Typography> : null}
    </Card>
  );
}
