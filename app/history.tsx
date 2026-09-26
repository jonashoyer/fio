import { ChevronLeft, Trash2 } from 'lucide-react-native';
import { Button, Card, Typography, useThemeColor } from 'heroui-native';
import { useEffect } from 'react';
import { ActivityIndicator, Alert, FlatList, Platform, View } from 'react-native';
import { useRouter } from 'expo-router';

import { FioBird } from '@/components/FioBird';
import { useThreadStore } from '@/lib/fio/thread-store';

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

        {error ? <Typography className="text-danger mb-3 text-sm">{error}</Typography> : null}
        {isLoading && !history.length ? <ActivityIndicator color={accent} /> : null}
        {!isLoading && !history.length ? (
          <View className="flex-1 items-center justify-center">
            <Typography className="text-muted text-lg">No saved conversations yet.</Typography>
          </View>
        ) : null}
        <FlatList
          data={history}
          keyExtractor={({ id }) => id}
          contentContainerClassName="gap-3 pb-safe-or-6"
          renderItem={({ item }) => (
            <Card className="border-border bg-background flex-row items-center gap-3 border p-4">
              <Button
                className="min-h-12 flex-1 items-start py-2"
                variant="tertiary"
                onPress={() => void reopen(item.id)}
              >
                <View className="flex-1 items-start gap-1">
                  <Typography className="text-foreground text-base font-semibold" numberOfLines={1}>
                    {item.title}
                  </Typography>
                  <Typography className="text-muted text-sm">
                    {item.turns.length} {item.turns.length === 1 ? 'turn' : 'turns'} ·{' '}
                    {item.artifacts.length} {item.artifacts.length === 1 ? 'artifact' : 'artifacts'}
                  </Typography>
                </View>
              </Button>
              <Button
                isIconOnly
                variant="tertiary"
                onPress={() => confirmDelete(item.id, item.title)}
                accessibilityLabel={`Delete ${item.title}`}
              >
                <Trash2 color={danger} size={20} />
              </Button>
            </Card>
          )}
        />
      </View>
    </View>
  );
}
