import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { colors } from '../theme';
import HomeScreen from '../screens/HomeScreen';
import ExploreScreen from '../screens/ExploreScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import CreateProjectScreen from '../screens/CreateProjectScreen';
import ProjectDetailScreen from '../screens/ProjectDetailScreen';
import CheckoutScreen from '../screens/CheckoutScreen';
import AuthScreen from '../screens/AuthScreen';
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import MyProjectsScreen from '../screens/MyProjectsScreen';
import ManageProjectScreen from '../screens/ManageProjectScreen';
import AdminScreen from '../screens/AdminScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const TAB_ICONS = {
  HomeTab: ['home', 'home-outline'],
  ExploreTab: ['compass', 'compass-outline'],
  CreateTab: ['add-circle', 'add-circle-outline'],
  NotificationsTab: ['notifications', 'notifications-outline'],
  ProfileTab: ['person', 'person-outline'],
};

function MainTabs() {
  const { unread } = useApp();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.soft,
        tabBarStyle: {
          backgroundColor: colors.white,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          paddingTop: 4,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700', paddingBottom: 2 },
        tabBarIcon: ({ focused, color, size }) => {
          const [active, inactive] = TAB_ICONS[route.name] || TAB_ICONS.HomeTab;
          return <Ionicons name={focused ? active : inactive} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="HomeTab" component={HomeScreen} options={{ title: 'Trang chủ' }} />
      <Tab.Screen name="ExploreTab" component={ExploreScreen} options={{ title: 'Khám phá' }} />
      <Tab.Screen name="CreateTab" component={CreateProjectScreen} options={{ title: 'Tạo dự án' }} />
      <Tab.Screen
        name="NotificationsTab"
        component={NotificationsScreen}
        options={{
          title: 'Thông báo',
          tabBarBadge: unread > 0 ? unread : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.red, color: '#fff', fontSize: 9 },
        }}
      />
      <Tab.Screen name="ProfileTab" component={ProfileScreen} options={{ title: 'Cá nhân' }} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.white },
        headerTintColor: colors.primaryDark,
        headerTitleStyle: { fontWeight: '800', fontSize: 15 },
        headerShadowVisible: false,
        headerBackTitleVisible: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
      <Stack.Screen name="ProjectDetail" component={ProjectDetailScreen} options={{ title: 'Chi tiết dự án' }} />
      <Stack.Screen name="Checkout" component={CheckoutScreen} options={{ title: 'Tài trợ dự án' }} />
      <Stack.Screen name="Auth" component={AuthScreen} options={{ title: 'Tài khoản' }} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ title: 'Quên mật khẩu' }} />
      <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ title: 'Chọn chủ đề' }} />
      <Stack.Screen name="MyProjects" component={MyProjectsScreen} options={{ title: 'Dự án của tôi' }} />
      <Stack.Screen name="ManageProject" component={ManageProjectScreen} options={{ title: 'Quản lý dự án' }} />
      <Stack.Screen name="CreateProject" component={CreateProjectScreen} options={{ title: 'Tạo dự án' }} />
      <Stack.Screen name="Admin" component={AdminScreen} options={{ title: 'Quản trị hệ thống' }} />
    </Stack.Navigator>
  );
}
