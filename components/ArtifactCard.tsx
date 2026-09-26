import { Copy, RotateCcw, Volume2 } from 'lucide-react-native';
import { Button, Typography, useThemeColor } from 'heroui-native';
import { useEffect, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';

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

  useEffect(() => {
    const previousSavedText = savedArtifactRef.current.text;
    savedArtifactRef.current = artifact;
    // A voice or history update replaces the displayed text only when the user
    // has no unsaved typing. The next local save uses the latest artifact as its base.
    if (draftRef.current === previousSavedText) {
      draftRef.current = artifact.text;
      setDraft(artifact.text);
    }
  }, [artifact]);

  const saveSnapshot = async (snapshot: string): Promise<boolean> => {
    const pendingSave = savePromiseRef.current;
    if (pendingSave?.text === snapshot) return pendingSave.promise;
    if (pendingSave) await pendingSave.promise;
    if (snapshot === savedArtifactRef.current.text) return true;

    const now = new Date().toISOString();
    const baseArtifact = savedArtifactRef.current;
    const updatedArtifact: Artifact = {
      ...baseArtifact,
      text: snapshot,
      previous: { text: baseArtifact.text, savedAt: now },
      updatedAt: now,
    };
    const promise = onSave(updatedArtifact)
      .then((saved) => {
        // A newer prop may have arrived while this save was in flight.
        if (saved && savedArtifactRef.current === baseArtifact)
          savedArtifactRef.current = updatedArtifact;
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
    const snapshot = { id: artifact.id, text: draftRef.current };
    setFrozenReadText(snapshot.text);
    try {
      await onRead(snapshot);
      setNotice('Reading the frozen artifact text.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Read aloud is unavailable.');
    }
  };

  return (
    <View
      className={
        isSelected
          ? 'border-accent bg-background gap-4 border-y px-5 py-6'
          : 'border-border bg-background gap-4 border-y px-5 py-6'
      }
    >
      <View className="flex-row items-center justify-between gap-3">
        <Typography className="text-foreground font-semibold">{artifact.title}</Typography>
        {!isSelected ? (
          <Button
            size="md"
            variant="tertiary"
            onPress={() => onSelect(artifact.id)}
            accessibilityLabel={`Select ${artifact.title}`}
          >
            <Button.Label>Select</Button.Label>
          </Button>
        ) : null}
      </View>
      <TextInput
        value={draft}
        onChangeText={(text) => {
          draftRef.current = text;
          setDraft(text);
        }}
        onBlur={() => void save()}
        multiline
        className="text-foreground min-h-32 bg-transparent text-[18px] leading-7"
        style={{ padding: 0, borderWidth: 0, borderRadius: 0, textAlignVertical: 'top' }}
        accessibilityLabel={`${artifact.title} text`}
      />
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
        <View className="border-border gap-1 border-t pt-3">
          <Typography className="text-muted text-sm font-medium">Frozen read-aloud text</Typography>
          <Typography className="text-foreground text-base leading-6">{frozenReadText}</Typography>
        </View>
      ) : null}
      {notice ? <Typography className="text-muted text-sm">{notice}</Typography> : null}
    </View>
  );
}
