import { History, ImagePlus, Mic, Plus, Send, X } from 'lucide-react-native';
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
import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';

import { ArtifactCard } from '@/components/ArtifactCard';
import { FioBird } from '@/components/FioBird';
import { attachmentService } from '@/lib/fio/attachment-service';
import { VOICE_UNAVAILABLE_MESSAGE, voiceService } from '@/lib/fio/services';
import { createArtifact, createThread, createUserTurn, nextThread } from '@/lib/fio/thread-helpers';
import { useThreadStore } from '@/lib/fio/thread-store';
import type { Artifact, Attachment, Thread } from '@/lib/fio/types';

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
  const [accent, danger] = useThemeColor(['accent', 'danger']);

  const talk = async () => {
    try {
      await voiceService.startConversation();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : VOICE_UNAVAILABLE_MESSAGE);
    }
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
    setNotice(VOICE_UNAVAILABLE_MESSAGE);
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
    if (!active) return false;
    return persist(
      nextThread(active, {
        artifacts: active.artifacts.map((item) => (item.id === artifact.id ? artifact : item)),
      }),
    );
  };

  const beginNew = () => {
    startNew();
    setText('');
    setAttachments([]);
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
        <View className="flex-row items-center justify-between px-5 py-3">
          <View className="flex-row items-center gap-3">
            <FioBird size={24} />
            <Typography className="text-foreground text-xl font-semibold">Fio</Typography>
          </View>
          <View className="flex-row gap-2">
            <Button
              isIconOnly
              variant="tertiary"
              onPress={beginNew}
              accessibilityLabel="New conversation"
            >
              <Plus color={accent} size={22} />
            </Button>
            <Button
              isIconOnly
              variant="tertiary"
              onPress={() => router.push('/history')}
              accessibilityLabel="History"
            >
              <History color={accent} size={21} />
            </Button>
          </View>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerClassName="grow gap-5 px-5 pb-6"
          keyboardShouldPersistTaps="handled"
        >
          {!active ? (
            <View className="flex-1 items-start justify-center gap-5 py-12">
              <FioBird size={48} />
              <Typography className="text-foreground max-w-lg text-3xl leading-10 font-semibold">
                What are you writing?
              </Typography>
              <Button size="lg" onPress={() => void talk()} accessibilityLabel="Talk to Fio">
                <Mic color="#FFFFFF" size={21} />
                <Button.Label>Talk to Fio</Button.Label>
              </Button>
            </View>
          ) : null}

          {active?.turns.map((turn) => (
            <View key={turn.id} className="gap-2">
              <Typography className="text-muted text-sm font-medium">You</Typography>
              <Typography className="text-foreground text-[18px] leading-7">{turn.text}</Typography>
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
              key={`${artifact.id}-${artifact.updatedAt}`}
              artifact={artifact}
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
