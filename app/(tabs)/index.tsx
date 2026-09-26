import {
  History,
  ImagePlus,
  Mic,
  MicOff,
  Plus,
  Send,
  Square,
  VolumeX,
  X,
} from 'lucide-react-native';
import {
  Button,
  Card,
  Input,
  Label,
  TextArea,
  TextField,
  Typography,
  useThemeColor,
} from 'heroui-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';

import { ArtifactCard } from '@/components/ArtifactCard';
import { FioBird } from '@/components/FioBird';
import { LinearGradient } from '@/components/ui/primitives/LinearGradient';
import { attachmentService } from '@/lib/fio/attachment-service';
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

export default function ConversationScreen() {
  const router = useRouter();
  const {
    active,
    error,
    persist,
    referenceContext,
    saveReferenceContext,
    setReferenceContext,
    startNew,
  } = useThreadStore();
  const [text, setText] = useState('');
  const [showContext, setShowContext] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [voiceStatus, setVoiceStatus] = useState(voiceService.getStatus());
  const [accent, danger] = useThemeColor(['accent', 'danger']);
  const activeRef = useRef(active);
  const persistRef = useRef(persist);
  const referenceContextRef = useRef(referenceContext);
  const previousActiveIdRef = useRef(active?.id);

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
      getArtifacts: () => activeRef.current?.artifacts ?? [],
      onSelectArtifact: setSelectedArtifactId,
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
        if (!current) throw new Error('The voice artifact has no saved thread target.');
        const existing = current.artifacts.find(({ id }) => id === artifact.id);
        const confirmed =
          canUndo && existing
            ? { ...artifact, previous: { text: existing.text, savedAt: artifact.updatedAt } }
            : artifact;
        const artifacts = existing
          ? current.artifacts.map((item) => (item.id === confirmed.id ? confirmed : item))
          : [...current.artifacts, confirmed];
        const thread = nextThread(current, { artifacts });
        activeRef.current = thread;
        setSelectedArtifactId(confirmed.id);
        if (!(await persistRef.current(thread)))
          throw new Error('The confirmed artifact could not be saved locally.');
      },
    }),
    [],
  );

  useEffect(() => voiceService.subscribe(setVoiceStatus), []);
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
    if (!text.trim()) return;
    const turn = createUserTurn(text, attachments);
    const thread = active
      ? nextThread(active, {
          turns: [...active.turns, turn],
          attachments: [...active.attachments, ...attachments],
          referenceContext: referenceContext.trim() ? referenceContext : undefined,
        })
      : {
          ...createThread(turn),
          attachments,
          referenceContext: referenceContext.trim() ? referenceContext : undefined,
        };
    setText('');
    setAttachments([]);
    setShowContext(false);
    setNotice(null);
    await persist(thread);
  };

  const makeArtifact = async () => {
    if (!text.trim()) {
      setNotice('Write something first, then make it an artifact.');
      return;
    }
    const artifact = createArtifact(text.trim());
    const turn = createUserTurn(text, attachments);
    let thread: Thread;
    if (active) {
      thread = nextThread(active, {
        turns: [...active.turns, turn],
        artifacts: [...active.artifacts, artifact],
        attachments: [...active.attachments, ...attachments],
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
    setText('');
    setAttachments([]);
    setShowContext(false);
    const saved = await persist(thread);
    setNotice(saved ? 'Saved as a manual artifact.' : 'Manual artifact could not be saved.');
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
    void voiceService.disconnect();
    startNew();
    setText('');
    setAttachments([]);
    setSelectedArtifactId(null);
    setNotice(null);
  };

  const toggleContext = () => {
    if (showContext) void saveReferenceContext(referenceContext);
    setShowContext((value) => !value);
  };

  return (
    <KeyboardAvoidingView
      className="bg-background flex-1"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={88}
    >
      <View className="mx-auto w-full max-w-3xl flex-1">
        {!active ? (
          <LinearGradient
            colors={['#F8F7F4', '#F4B58E', '#9DD9D0', '#F8F7F4']}
            locations={[0, 0.2, 0.76, 1]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            className="relative h-[185px] overflow-hidden rounded-b-[28px]"
          >
            <View className="bg-background absolute top-[18px] left-[18px] h-[75px] w-[75px] items-center justify-center rounded-full">
              <FioBird size={50} />
            </View>
            <View className="absolute top-6 left-[109px] gap-0.5">
              <Typography className="text-foreground text-2xl font-semibold">Fio</Typography>
              <Typography className="text-foreground text-sm">AI writing companion</Typography>
            </View>
            <Button
              isIconOnly
              size="md"
              variant="tertiary"
              className="absolute top-[18px] right-[18px]"
              onPress={() => router.push('/history')}
              accessibilityLabel="History"
            >
              <History color={accent} size={21} />
            </Button>
            <View className="absolute right-[18px] bottom-[18px] left-[18px] flex-row items-center gap-2">
              <Button size="lg" onPress={() => void talk()} accessibilityLabel="Talk to Fio">
                <Mic color="#FFFFFF" size={21} />
                <Button.Label>Talk to Fio</Button.Label>
              </Button>
              <Button
                size="lg"
                variant="tertiary"
                onPress={() => setNotice('Type in the writing field below.')}
                accessibilityLabel="Type instead"
              >
                <Button.Label>Type instead</Button.Label>
              </Button>
            </View>
          </LinearGradient>
        ) : (
          <View className="flex-row items-center justify-between px-5 py-3">
            <View className="flex-row items-center gap-3">
              <FioBird size={24} />
              <View>
                <Typography className="text-foreground text-xl font-semibold">Fio</Typography>
                <Typography className="text-muted text-xs">AI writing companion</Typography>
              </View>
            </View>
            <View className="flex-row gap-2">
              <Button
                isIconOnly
                size="md"
                variant="tertiary"
                onPress={beginNew}
                accessibilityLabel="New conversation"
              >
                <Plus color={accent} size={22} />
              </Button>
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
        )}

        <ScrollView
          className="flex-1"
          contentContainerClassName="grow gap-5 px-5 pb-6 pt-5"
          keyboardShouldPersistTaps="handled"
        >
          {active || voiceStatus.phase !== 'unconfigured' ? (
            <Card className="bg-fio-bubble gap-3 border-0 p-4">
              <View className="flex-row flex-wrap items-center gap-2">
                {voiceStatus.phase === 'idle' ||
                voiceStatus.phase === 'stopped' ||
                voiceStatus.phase === 'error' ||
                voiceStatus.phase === 'unconfigured' ? (
                  <Button onPress={() => void talk()} accessibilityLabel="Talk to Fio">
                    <Mic color="#FFFFFF" size={20} />
                    <Button.Label>Talk to Fio</Button.Label>
                  </Button>
                ) : null}
                {voiceStatus.phase === 'connecting' ||
                voiceStatus.phase === 'listening' ||
                voiceStatus.phase === 'processing' ? (
                  <Button variant="secondary" onPress={() => void voiceService.stopListening()}>
                    <Square color={accent} size={18} />
                    <Button.Label>Stop listening</Button.Label>
                  </Button>
                ) : null}
                {voiceStatus.phase === 'speaking' ? (
                  <Button variant="secondary" onPress={() => void voiceService.stopSpeaking()}>
                    <VolumeX color={accent} size={18} />
                    <Button.Label>Stop Fio</Button.Label>
                  </Button>
                ) : null}
                {voiceStatus.phase === 'listening' || voiceStatus.phase === 'processing' ? (
                  <Button
                    variant="tertiary"
                    onPress={() => voiceService.setMuted(!voiceStatus.isMuted)}
                  >
                    <MicOff color={accent} size={18} />
                    <Button.Label>{voiceStatus.isMuted ? 'Unmute' : 'Mute'}</Button.Label>
                  </Button>
                ) : null}
              </View>
              <Typography className="text-muted text-sm">
                Voice: {voiceStatus.phase === 'unconfigured' ? 'unavailable' : voiceStatus.phase}
              </Typography>
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
              {voiceStatus.message ? (
                <Typography className="text-foreground text-sm leading-5">
                  {voiceStatus.message}
                </Typography>
              ) : null}
            </Card>
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
            <ArtifactCard
              key={artifact.id}
              artifact={artifact}
              isSelected={
                selectedArtifactId === artifact.id ||
                (selectedArtifactId === null && active.artifacts[0]?.id === artifact.id)
              }
              onSelect={setSelectedArtifactId}
              onRead={readArtifact}
              onSave={saveArtifact}
            />
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

          {showContext ? (
            <TextField>
              <Label>Reference context</Label>
              <TextArea
                value={referenceContext}
                onChangeText={setReferenceContext}
                onBlur={() => void saveReferenceContext(referenceContext)}
                placeholder="Paste background text"
                className="min-h-20"
                accessibilityLabel="Reference context"
              />
            </TextField>
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

          <View className="flex-row items-end gap-2">
            <TextField className="flex-1">
              <Label className="sr-only">Writing</Label>
              <Input
                value={text}
                onChangeText={setText}
                placeholder="Write to Fio"
                multiline
                className="min-h-12 text-[18px]"
                accessibilityLabel="Writing"
              />
            </TextField>
            <Button
              isIconOnly
              onPress={() => void send()}
              isDisabled={!text.trim()}
              accessibilityLabel="Save turn"
            >
              <Send color="#FFFFFF" size={20} />
            </Button>
          </View>
          <View className="flex-row flex-wrap gap-2">
            <Button size="md" variant="tertiary" onPress={toggleContext}>
              <Plus color={accent} size={18} />
              <Button.Label>Text context</Button.Label>
            </Button>
            <Button size="md" variant="tertiary" onPress={() => void pickImage()}>
              <ImagePlus color={accent} size={18} />
              <Button.Label>Photo of text</Button.Label>
            </Button>
            <Button
              size="md"
              variant="secondary"
              onPress={() => void makeArtifact()}
              isDisabled={!text.trim()}
            >
              <Button.Label>Make artifact</Button.Label>
            </Button>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
