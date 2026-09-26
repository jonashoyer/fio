import * as Crypto from 'expo-crypto';
import {
  History,
  ImagePlus,
  FileText,
  Mic,
  MicOff,
  Plus,
  Send,
  Square,
  X,
} from 'lucide-react-native';
import { Button, Card, Input, Label, TextField, Typography, useThemeColor } from 'heroui-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
  type TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';

import { ArtifactCard } from '@/components/ArtifactCard';
import { LiveBridgeHost } from '@/components/LiveBridgeHost';
import { FioBird } from '@/components/FioBird';
import { SafeAreaView } from '@/components/ui/primitives/SafeAreaView';
import { attachmentService } from '@/lib/fio/attachment-service';
import { FioApiClient } from '@/lib/fio/fio-api-client';
import { installationCredentialStore } from '@/lib/fio/installation-credential-store';
import { VOICE_UNAVAILABLE_MESSAGE, voiceService } from '@/lib/fio/services';
import {
  createArtifact,
  createFioTurn,
  createThread,
  createUserTurn,
  nextThread,
} from '@/lib/fio/thread-helpers';
import { useThreadStore } from '@/lib/fio/thread-store';
import type {
  Artifact,
  Attachment,
  Thread,
  VoiceArtifactSnapshot,
  VoiceSessionContext,
} from '@/lib/fio/types';

const textApi = new FioApiClient(installationCredentialStore, 'https://fioai.vercel.app/api/fio');
const textComposeEnabled = process.env.EXPO_PUBLIC_FIO_TEXT_COMPOSE_ENABLED === '1';

export default function ConversationScreen() {
  const router = useRouter();
  const { active, error, persist, referenceContext, startNew } = useThreadStore();
  const [text, setText] = useState('');
  const [writingFocused, setWritingFocused] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const selectedArtifactIdRef = useRef<string | null>(null);
  const [voiceStatus, setVoiceStatus] = useState(voiceService.getStatus());
  const [accent, danger] = useThemeColor(['accent', 'danger']);
  const activeRef = useRef(active);
  const persistRef = useRef(persist);
  const referenceContextRef = useRef(referenceContext);
  const previousActiveIdRef = useRef(active?.id);
  const writingInputRef = useRef<TextInput>(null);
  const sendingRef = useRef(false);
  const sendGenerationRef = useRef(0);
  const voiceInProgress = ['connecting', 'listening', 'processing', 'speaking'].includes(
    voiceStatus.phase,
  );
  const selectArtifact = useCallback((id: string) => {
    selectedArtifactIdRef.current = id;
    setSelectedArtifactId(id);
    voiceService.selectionChanged?.();
  }, []);

  useEffect(() => {
    if (previousActiveIdRef.current && previousActiveIdRef.current !== active?.id) {
      void voiceService.disconnect();
    }
    previousActiveIdRef.current = active?.id;
    activeRef.current = active;
    persistRef.current = persist;
    referenceContextRef.current = referenceContext;
  }, [active, persist, referenceContext]);

  const voiceContext = useMemo<VoiceSessionContext>(
    () => ({
      getThreadId: () => activeRef.current?.id,
      getThreadSnapshot: () => activeRef.current,
      getSelectedArtifactId: () => selectedArtifactIdRef.current,
      getArtifacts: () => activeRef.current?.artifacts ?? [],
      onSelectArtifact: selectArtifact,
      onFinalUserTranscript: async (transcript) => {
        if (!transcript.trim()) return;
        const turn = createUserTurn(transcript, []);
        const current = activeRef.current;
        const thread = current
          ? nextThread(current, { turns: [...current.turns, turn] })
          : {
              ...createThread(turn),
              referenceContext: referenceContextRef.current.trim()
                ? referenceContextRef.current
                : undefined,
            };
        activeRef.current = thread;
        if (!(await persistRef.current(thread)))
          throw new Error('The spoken turn could not be saved.');
      },
      onFinalFioTranscript: async (transcript) => {
        if (!transcript.trim() || !activeRef.current) return;
        const current = activeRef.current;
        const thread = nextThread(current, {
          turns: [...current.turns, createFioTurn(transcript)],
        });
        activeRef.current = thread;
        if (!(await persistRef.current(thread)))
          throw new Error('Fio’s spoken turn could not be saved.');
      },
      onPersistedArtifact: async (artifact, canUndo) => {
        const current = activeRef.current;
        if (!current) {
          const thread: Thread = {
            id: Crypto.randomUUID(),
            title: artifact.title,
            turns: [],
            attachments: [],
            artifacts: [artifact],
            createdAt: artifact.createdAt,
            updatedAt: artifact.updatedAt,
            revision: 1,
          };
          activeRef.current = thread;
          if (!(await persistRef.current(thread)))
            throw new Error('The new voice artifact could not be saved locally.');
          return;
        }
        const existing = current.artifacts.find(({ id }) => id === artifact.id);
        const confirmed =
          canUndo && existing
            ? {
                ...artifact,
                previous:
                  existing.text === artifact.text
                    ? existing.previous
                    : { text: existing.text, savedAt: artifact.updatedAt },
              }
            : artifact;
        const artifacts = existing
          ? current.artifacts.map((item) => (item.id === confirmed.id ? confirmed : item))
          : [...current.artifacts, confirmed];
        const thread = nextThread(current, { artifacts });
        activeRef.current = thread;
        if (!(await persistRef.current(thread)))
          throw new Error('The confirmed artifact could not be saved locally.');
      },
    }),
    [selectArtifact],
  );

  useEffect(() => voiceService.subscribe(setVoiceStatus), []);
  useEffect(() => {
    selectedArtifactIdRef.current = selectedArtifactId;
  }, [selectedArtifactId]);
  useEffect(() => () => void voiceService.disconnect(), []);

  const talk = async () => {
    try {
      await voiceService.startConversation(voiceContext);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : VOICE_UNAVAILABLE_MESSAGE);
    }
  };

  const readArtifact = async (snapshot: VoiceArtifactSnapshot) => {
    await voiceService.readArtifact(snapshot, voiceContext);
  };

  const pickImage = async () => {
    try {
      const attachment = await attachmentService.pickImage();
      if (attachment) setAttachments((items) => [...items, attachment]);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Photo selection is unavailable.');
    }
  };

  const removePendingAttachment = async (attachment: Attachment) => {
    await attachmentService.remove(attachment);
    setAttachments((items) => items.filter(({ id }) => id !== attachment.id));
  };

  const send = async () => {
    if (sendingRef.current) return;
    if (!text.trim() && !attachments.length) {
      setNotice('Write something or add a photo first.');
      return;
    }
    sendingRef.current = true;
    setIsSending(true);
    setNotice(null);
    const generation = ++sendGenerationRef.current;
    const pendingText = text;
    const pendingAttachments = attachments;
    const current = activeRef.current;
    const selected =
      current?.artifacts.find(({ id }) => id === selectedArtifactIdRef.current) ??
      current?.artifacts[0];
    try {
      const turn = createUserTurn(pendingText.trim() || 'Photo', pendingAttachments);
      const thread = current
        ? nextThread(current, {
            turns: [...current.turns, turn],
            attachments: [...current.attachments, ...pendingAttachments],
            referenceContext: referenceContext.trim() ? referenceContext : undefined,
          })
        : {
            ...createThread(turn),
            attachments: pendingAttachments,
            referenceContext: referenceContext.trim() ? referenceContext : undefined,
          };
      if (!(await persist(thread))) {
        setNotice('Could not save this turn. Your writing and photo remain here.');
        return;
      }
      activeRef.current = thread;
      setText('');
      setAttachments([]);
      if (!pendingText.trim()) {
        setNotice('Photo added to this conversation. Fio has not analyzed it.');
        return;
      }
      if (!textComposeEnabled) {
        setNotice(
          'Added to this conversation. Fio text replies are unavailable until the server is ready.',
        );
        return;
      }
      const result = await textApi.composeText(pendingText.trim(), selected?.text ?? null);
      if (generation !== sendGenerationRef.current || activeRef.current?.id !== thread.id) return;
      const latest = activeRef.current;
      const target = selected && latest.artifacts.find(({ id }) => id === selected.id);
      if (result.action === 'update' && !target) {
        setNotice(
          'Fio returned an edit for a draft that is no longer here. Your writing is saved.',
        );
        return;
      }
      const artifact =
        result.action === 'update' && target
          ? {
              ...target,
              text: result.artifact,
              updatedAt: new Date().toISOString(),
              previous:
                target.text === result.artifact
                  ? target.previous
                  : { text: target.text, savedAt: new Date().toISOString() },
            }
          : createArtifact(result.artifact, 'message');
      const completed = nextThread(latest, {
        turns: [...latest.turns, createFioTurn(result.reply)],
        artifacts:
          result.action === 'update' && target
            ? latest.artifacts.map((item) => (item.id === target.id ? artifact : item))
            : [...latest.artifacts, artifact],
      });
      activeRef.current = completed;
      if (!(await persist(completed))) {
        setNotice('Fio replied, but the result could not be saved. Keep this screen open.');
        return;
      }
      if (result.action === 'create') selectArtifact(artifact.id);
      setNotice(
        pendingAttachments.length
          ? 'Fio used your text. The photo was saved but not analyzed.'
          : null,
      );
    } catch (cause) {
      if (generation === sendGenerationRef.current) {
        setNotice(
          cause instanceof Error
            ? `Fio could not finish: ${cause.message}. Your words are saved; try again.`
            : 'Fio could not finish. Your words are saved; try again.',
        );
      }
    } finally {
      sendingRef.current = false;
      setIsSending(false);
    }
  };

  const makeArtifact = async () => {
    if (!text.trim()) {
      setNotice('Write something first to add it as an artifact.');
      return;
    }
    const artifact = createArtifact(text.trim());
    const turn = createUserTurn(text, attachments);
    const current = activeRef.current;
    let thread: Thread;
    if (current) {
      thread = nextThread(current, {
        turns: [...current.turns, turn],
        artifacts: [...current.artifacts, artifact],
        attachments: [...current.attachments, ...attachments],
        referenceContext: referenceContext.trim() ? referenceContext : undefined,
      });
    } else {
      thread = {
        ...createThread(turn),
        title: artifact.text.slice(0, 48),
        artifacts: [artifact],
        attachments,
        referenceContext: referenceContext.trim() ? referenceContext : undefined,
      };
    }
    const saved = await persist(thread);
    if (saved) {
      activeRef.current = thread;
      setText('');
      setAttachments([]);
    }
    setNotice(
      saved ? 'Text added as an artifact.' : 'Could not add the text. Your writing remains here.',
    );
  };

  const saveArtifact = async (artifact: Artifact) => {
    const current = activeRef.current;
    if (!current) return false;
    const existing = current.artifacts.find((item) => item.id === artifact.id);
    if (!existing) return false;
    if (
      existing.text === artifact.text &&
      existing.previous?.text === artifact.previous?.text &&
      existing.previous?.savedAt === artifact.previous?.savedAt
    ) {
      return true;
    }
    const thread = nextThread(current, {
      artifacts: current.artifacts.map((item) => (item.id === artifact.id ? artifact : item)),
    });
    activeRef.current = thread;
    return persist(thread);
  };

  const beginNew = () => {
    sendGenerationRef.current++;
    void voiceService.disconnect();
    startNew();
    setText('');
    setAttachments([]);
    setSelectedArtifactId(null);
    setNotice(null);
  };

  return (
    <KeyboardAvoidingView
      className="bg-background flex-1"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={88}
    >
      <SafeAreaView edges={['top']} className="mx-auto w-full max-w-3xl flex-1">
        <View className="border-border flex-row items-center justify-between border-b px-5 py-3">
          <View className="flex-row items-center gap-3">
            <FioBird size={24} />
            <View>
              <Typography className="text-foreground text-2xl font-semibold">Fio</Typography>
              <Typography className="text-muted text-sm">AI writing companion</Typography>
            </View>
          </View>
          <View className="flex-row gap-2">
            {active ? (
              <Button
                isIconOnly
                size="md"
                variant="tertiary"
                onPress={beginNew}
                accessibilityLabel="New conversation"
              >
                <Plus color={accent} size={22} />
              </Button>
            ) : null}
            <Button
              isIconOnly
              size="md"
              variant="tertiary"
              onPress={() => router.push('/history')}
              accessibilityLabel="History"
            >
              <History color={accent} size={21} />
            </Button>
          </View>
        </View>

        <LiveBridgeHost />
        <ScrollView
          className="flex-1"
          contentContainerClassName="grow gap-5 px-5 pb-6 pt-5"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {isSending ? (
            <View className="flex-row items-center gap-2" accessibilityLiveRegion="polite">
              <ActivityIndicator color={accent} size="small" />
              <Typography className="text-muted text-sm">Fio is working on your words…</Typography>
            </View>
          ) : null}
          {!active && !voiceInProgress && voiceStatus.phase !== 'error' ? (
            <View className="min-h-[300px] flex-1 items-center justify-center gap-6 py-8">
              <Typography className="text-foreground text-center text-[24px] leading-8 font-semibold">
                Tell Fio what you want to say.
              </Typography>
              <Button
                size="lg"
                className="min-h-14 min-w-[240px]"
                onPress={() => void talk()}
                accessibilityLabel="Talk to Fio"
              >
                <Mic color="#FFFFFF" size={22} />
                <Button.Label>Talk to Fio</Button.Label>
              </Button>
            </View>
          ) : null}
          {voiceInProgress || voiceStatus.phase === 'error' ? (
            <View className="gap-3">
              <Typography className="sr-only" accessibilityLiveRegion="polite">
                {voiceStatus.phase === 'listening'
                  ? 'Listening'
                  : voiceStatus.phase === 'speaking'
                    ? 'Fio is speaking'
                    : voiceStatus.phase === 'processing'
                      ? 'Fio is working'
                      : voiceStatus.phase === 'connecting'
                        ? 'Connecting to Fio'
                        : 'Voice needs attention'}
              </Typography>
              {voiceStatus.phase === 'connecting' ||
              voiceStatus.phase === 'processing' ||
              voiceStatus.phase === 'error' ? (
                <View className="flex-row items-center gap-2">
                  {voiceStatus.phase !== 'error' ? (
                    <ActivityIndicator color={accent} size="small" />
                  ) : null}
                  <Typography className="text-muted text-sm" accessibilityLiveRegion="polite">
                    {voiceStatus.phase === 'error'
                      ? (voiceStatus.message ?? 'Voice needs attention. You can type below.')
                      : voiceStatus.phase === 'connecting'
                        ? 'Connecting to Fio…'
                        : 'Fio is working on your words…'}
                  </Typography>
                </View>
              ) : null}
              {voiceStatus.youSaid ? (
                <View className="items-end gap-1">
                  <Typography className="text-muted text-sm font-medium">You said</Typography>
                  <View className="bg-user-bubble max-w-[88%] rounded-2xl rounded-tr-sm px-4 py-3">
                    <Typography className="text-foreground text-[18px] leading-7">
                      {voiceStatus.youSaid}
                    </Typography>
                  </View>
                </View>
              ) : null}
              {voiceStatus.fioSaid ? (
                <View className="items-start gap-1">
                  <View className="flex-row items-center gap-2">
                    <FioBird size={24} />
                    <Typography className="text-muted text-sm font-medium">Fio said</Typography>
                  </View>
                  <View className="bg-background max-w-[88%] rounded-2xl rounded-tl-sm px-4 py-3">
                    <Typography className="text-foreground text-[18px] leading-7">
                      {voiceStatus.fioSaid}
                    </Typography>
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}

          {active?.turns.map((turn) => (
            <View
              key={turn.id}
              className={turn.role === 'user' ? 'items-end gap-2' : 'items-start gap-2'}
            >
              <View className="flex-row items-center gap-2">
                {turn.role === 'fio' ? <FioBird size={24} /> : null}
                <Typography className="text-muted text-sm font-medium">
                  {turn.role === 'user' ? 'You said' : 'Fio said'}
                </Typography>
              </View>
              <View
                className={
                  turn.role === 'user'
                    ? 'bg-user-bubble max-w-[88%] rounded-2xl rounded-tr-sm px-4 py-3'
                    : 'bg-fio-bubble max-w-[88%] rounded-2xl rounded-tl-sm px-4 py-3'
                }
              >
                <Typography className="text-foreground text-[18px] leading-7">
                  {turn.text}
                </Typography>
              </View>
              {turn.contextText ? (
                <Card className="border-border bg-background-secondary border p-3">
                  <Typography className="text-muted text-sm font-medium">Context</Typography>
                  <Typography className="text-foreground mt-1 text-base leading-6">
                    {turn.contextText}
                  </Typography>
                </Card>
              ) : null}
              {turn.attachmentIds.length ? (
                <ScrollView
                  horizontal
                  contentContainerClassName="gap-2"
                  showsHorizontalScrollIndicator={false}
                >
                  {active.attachments
                    .filter(({ id }) => turn.attachmentIds.includes(id))
                    .map((attachment) => (
                      <Image
                        key={attachment.id}
                        source={{ uri: attachment.uri }}
                        accessibilityLabel={attachment.name}
                        style={{ width: 112, height: 112, borderRadius: 12 }}
                        resizeMode="cover"
                      />
                    ))}
                </ScrollView>
              ) : null}
            </View>
          ))}

          {active?.artifacts.map((artifact) => (
            <View key={artifact.id} style={{ marginHorizontal: -20 }}>
              <ArtifactCard
                artifact={artifact}
                isSelected={
                  selectedArtifactId === artifact.id ||
                  (selectedArtifactId === null && active.artifacts[0]?.id === artifact.id)
                }
                onSelect={selectArtifact}
                onRead={readArtifact}
                onSave={saveArtifact}
              />
            </View>
          ))}
        </ScrollView>

        <View className="border-border bg-background pb-safe-or-4 gap-3 border-t px-5 pt-4">
          {notice ? (
            <Card className="bg-background-secondary flex-row items-start justify-between gap-3 p-3">
              <Typography className="text-foreground flex-1 text-sm leading-5">{notice}</Typography>
              <Button
                isIconOnly
                size="md"
                variant="tertiary"
                onPress={() => setNotice(null)}
                accessibilityLabel="Dismiss notice"
              >
                <X color={danger} size={18} />
              </Button>
            </Card>
          ) : null}
          {error ? (
            <Typography className="text-danger text-sm">Save error: {error}</Typography>
          ) : null}

          {attachments.length ? (
            <ScrollView
              horizontal
              contentContainerClassName="gap-2"
              showsHorizontalScrollIndicator={false}
            >
              {attachments.map((attachment) => (
                <View key={attachment.id}>
                  <Image
                    source={{ uri: attachment.uri }}
                    accessibilityLabel={attachment.name}
                    style={{ width: 72, height: 72, borderRadius: 10 }}
                    resizeMode="cover"
                  />
                  <Button
                    isIconOnly
                    size="md"
                    variant="secondary"
                    className="absolute -top-1 -right-1"
                    onPress={() => void removePendingAttachment(attachment)}
                    accessibilityLabel={`Remove ${attachment.name}`}
                  >
                    <X color={danger} size={16} />
                  </Button>
                </View>
              ))}
            </ScrollView>
          ) : null}

          {writingFocused ? (
            <View className="items-end">
              <Button
                size="sm"
                variant="tertiary"
                onPress={() => {
                  writingInputRef.current?.blur();
                  Keyboard.dismiss();
                }}
                accessibilityLabel="Close keyboard"
              >
                <Button.Label>Done</Button.Label>
              </Button>
            </View>
          ) : null}
          <View className="flex-row items-end gap-2">
            <TextField className="flex-1">
              <Label className="sr-only">Writing</Label>
              <Input
                ref={writingInputRef}
                value={text}
                onChangeText={setText}
                onFocus={() => setWritingFocused(true)}
                onBlur={() => setWritingFocused(false)}
                placeholder="Write it as it comes."
                multiline
                className="min-h-12 text-[18px]"
                accessibilityLabel="Type a message"
              />
            </TextField>
            <Button
              className="min-h-12"
              onPress={() => void (voiceInProgress ? makeArtifact() : send())}
              accessibilityLabel={
                voiceInProgress ? 'Add text as artifact' : 'Send writing or photo'
              }
              isDisabled={isSending || (!text.trim() && (voiceInProgress || !attachments.length))}
            >
              {isSending ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : voiceInProgress ? (
                <FileText color="#FFFFFF" size={20} />
              ) : (
                <Send color="#FFFFFF" size={20} />
              )}
              <Button.Label>
                {isSending ? 'Working' : voiceInProgress ? 'Add text' : 'Send'}
              </Button.Label>
            </Button>
          </View>
          <View className="flex-row flex-wrap gap-2">
            {!voiceInProgress && (active || voiceStatus.phase === 'error') ? (
              <Button
                size="md"
                variant="tertiary"
                onPress={() => void talk()}
                accessibilityLabel="Talk to Fio"
              >
                <Mic color={accent} size={18} />
                <Button.Label>Talk to Fio</Button.Label>
              </Button>
            ) : null}
            {voiceInProgress ? (
              <Button
                size="md"
                variant="tertiary"
                onPress={() =>
                  void (voiceStatus.phase === 'speaking'
                    ? voiceService.stopSpeaking()
                    : voiceService.stopListening())
                }
                accessibilityLabel={
                  voiceStatus.phase === 'speaking' ? 'Stop Fio' : 'Stop listening'
                }
              >
                <Square color={accent} size={18} />
                <Button.Label>Stop</Button.Label>
              </Button>
            ) : null}
            {voiceStatus.phase === 'listening' ||
            voiceStatus.phase === 'processing' ||
            voiceStatus.phase === 'speaking' ? (
              <Button
                size="md"
                variant="tertiary"
                onPress={() => voiceService.setMuted(!voiceStatus.isMuted)}
                accessibilityLabel={voiceStatus.isMuted ? 'Unmute voice' : 'Mute voice'}
              >
                {voiceStatus.isMuted ? (
                  <Mic color={accent} size={18} />
                ) : (
                  <MicOff color={accent} size={18} />
                )}
                <Button.Label>{voiceStatus.isMuted ? 'Unmute' : 'Mute'}</Button.Label>
              </Button>
            ) : null}
            <Button size="md" variant="tertiary" onPress={() => void pickImage()}>
              <ImagePlus color={accent} size={18} />
              <Button.Label>Add photo</Button.Label>
            </Button>
          </View>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}
