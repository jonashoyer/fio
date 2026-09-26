import { StatusBar } from 'expo-status-bar';
import { Tabs } from 'expo-router';

export default function TabLayout() {
  return (
    <>
      {/* eslint-disable-next-line react/style-prop-object -- Expo StatusBar accepts the documented "dark" style variant. */}
      <StatusBar style="dark" />
      <Tabs screenOptions={{ headerShown: false, tabBarStyle: { display: 'none' } }}>
        <Tabs.Screen name="index" options={{ title: 'Fio' }} />
      </Tabs>
    </>
  );
}
