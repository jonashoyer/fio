import { ChevronLeft, Trash2 } from 'lucide-react-native';
import { Button, Typography, useThemeColor } from 'heroui-native';
import { useEffect } from 'react';
import { ActivityIndicator, Alert, FlatList, Platform, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';

import { FioBird } from '@/components/FioBird';
import { useThreadStore } from '@/lib/fio/thread-store';
import type { Thread } from '@/lib/fio/types';

function threadPreview(thread: Thread) {
  const latestArtifact = thread.artifacts.at(-1)?.text.trim();
  if (latestArtifact && latestArtifact !== thread.title.trim()) return latestArtifact;
  const latestTurn = thread.turns.at(-1)?.text.trim();
  if (thread.turns.length > 1 && latestTurn !== thread.title.trim()) return latestTurn;
  const firstTurn = thread.turns[0]?.text.trim() ?? '';
  if (firstTurn.startsWith(thread.title) && firstTurn.length > thread.title.length) {
    return `…${firstTurn.slice(thread.title.length).trimStart()}`;
  }
  return null;
}

function updatedLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Saved conversation'
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function HistoryScreen() {
  const router = useRouter();
  const { history, error, isLoading, open, refresh, remove } = useThreadStore();
  const [accent, danger] = useThemeColor(['accent', 'danger']);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const confirmDelete = (id: string, title: string) => {
    if (Platform.OS === 'web') {
      if (
        globalThis.confirm(`Delete “${title}”? This conversation will be removed from this device.`)
      ) {
        void remove(id);
      }
      return;
    }

    Alert.alert('Delete conversation?', `“${title}” will be removed from this device.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void remove(id) },
    ]);
  };

  const reopen = async (id: string) => {
    await open(id);
    router.replace('/');
  };

  return (
    <View className="bg-background pt-safe flex-1">
      <View className="mx-auto w-full max-w-3xl flex-1 px-5">
        <View className="flex-row items-center gap-3 py-4">
          <Button
            isIconOnly
            variant="tertiary"
            onPress={() => router.replace('/')}
            accessibilityLabel="Back to conversation"
          >
            <ChevronLeft color={accent} size={24} />
          </Button>
          <FioBird size={24} />
          <Typography className="text-foreground text-2xl font-semibold">History</Typography>
        </View>

        {history.length ? (
          <Typography className="text-muted mb-4 text-base">Your saved conversations</Typography>
        ) : null}

        {error ? <Typography className="text-danger mb-3 text-sm">{error}</Typography> : null}
        {isLoading && !history.length ? <ActivityIndicator color={accent} /> : null}
        {!isLoading && !history.length ? (
          <View className="flex-1 items-center justify-center gap-4 px-6">
            <Typography className="text-foreground text-center text-lg font-medium">
              No saved conversations yet.
            </Typography>
            <Typography className="text-muted text-center text-base leading-6">
              A conversation appears here after you speak or type to Fio.
            </Typography>
            <Button onPress={() => router.replace('/')}>
              <Button.Label>Talk to Fio</Button.Label>
            </Button>
          </View>
        ) : null}
        <FlatList
          data={history}
          keyExtractor={({ id }) => id}
          contentContainerClassName="pb-safe-or-6"
          renderItem={({ item }) => (
            <View className="border-border flex-row items-center gap-2 border-b py-3">
              <Pressable
                className="min-h-20 flex-1 justify-center rounded-lg px-2 py-2"
                onPress={() => void reopen(item.id)}
                accessibilityRole="button"
                accessibilityLabel={`Open conversation: ${item.title}, updated ${updatedLabel(item.updatedAt)}`}
              >
                <View className="gap-1">
                  <Typography className="text-foreground text-base font-semibold" numberOfLines={2}>
                    {item.title.trim() || 'Untitled conversation'}
                  </Typography>
                  {threadPreview(item) ? (
                    <Typography className="text-muted text-sm leading-5" numberOfLines={2}>
                      {threadPreview(item)}
                    </Typography>
                  ) : null}
                  <Typography className="text-muted text-xs">
                    Updated {updatedLabel(item.updatedAt)}
                  </Typography>
                </View>
              </Pressable>
              <Button
                isIconOnly
                variant="tertiary"
                className="min-h-12 min-w-12"
                onPress={() => confirmDelete(item.id, item.title)}
                accessibilityLabel={`Delete conversation: ${item.title}`}
              >
                <Trash2 color={danger} size={20} />
              </Button>
            </View>
          )}
        />
      </View>
    </View>
  );
}
