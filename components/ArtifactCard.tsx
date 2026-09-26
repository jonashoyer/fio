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
  const draftRef = useRef(artifact.text);
  const savedArtifactRef = useRef(artifact);
  const savePromiseRef = useRef<{ text: string; promise: Promise<boolean> } | null>(null);
  const [accent, muted] = useThemeColor(['accent', 'muted']);

  const saveSnapshot = async (snapshot: string): Promise<boolean> => {
    const pendingSave = savePromiseRef.current;
    if (pendingSave?.text === snapshot) return pendingSave.promise;
    if (pendingSave) await pendingSave.promise;
    if (snapshot === savedArtifactRef.current.text) return true;

    const now = new Date().toISOString();
    const updatedArtifact: Artifact = {
      ...savedArtifactRef.current,
      text: snapshot,
      previous: { text: savedArtifactRef.current.text, savedAt: now },
      updatedAt: now,
    };
    const promise = onSave(updatedArtifact)
      .then((saved) => {
        if (saved) savedArtifactRef.current = updatedArtifact;
        setNotice(saved ? 'Artifact saved.' : 'Artifact could not be saved.');
        return saved;
      })
      .catch(() => {
        setNotice('Artifact could not be saved.');
        return false;
      });
    savePromiseRef.current = { text: snapshot, promise };
    try {
      return await promise;
    } finally {
      if (savePromiseRef.current?.promise === promise) savePromiseRef.current = null;
    }
  };

  const save = () => saveSnapshot(draftRef.current);

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
      draftRef.current = previousText;
      savedArtifactRef.current = { ...artifact, text: previousText, previous: undefined };
      setDraft(previousText);
      setNotice('Last artifact edit undone.');
    } else {
      setNotice('Artifact undo could not be saved.');
    }
  };

  const copy = async () => {
    const snapshot = draftRef.current;
    const copyRequest = clipboardService.copyExact(snapshot);
    const saveRequest = saveSnapshot(snapshot);
    try {
      const [saved] = await Promise.all([saveRequest, copyRequest]);
      setNotice(saved ? 'Copied exactly.' : 'Copied, but the latest edit could not be saved.');
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
          onChangeText={(text) => {
            draftRef.current = text;
            setDraft(text);
          }}
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
