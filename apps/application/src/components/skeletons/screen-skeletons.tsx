import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SkeletonBlock, SkeletonCard, SkeletonCircle, SkeletonGroup, SkeletonImage, SkeletonText } from './primitives';

export type ProfileSkeletonSection = 'overview' | 'profile' | 'orders' | 'addresses' | 'support';
type ActiveProps = { active?: boolean };

function Categories({ home = false }: { home?: boolean }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.categories}>
    {Array.from({ length: 6 }, (_, index) => <View key={index} style={s.category}>
      <SkeletonImage width={home ? 50 : 58} height={home ? 50 : 58} /><SkeletonText width={48} lineHeight={10} />
    </View>)}
  </ScrollView>;
}

/** Header/search and locally bundled sections are supplied by the real MenuScreen. */
export function HomeSkeleton({ active }: ActiveProps) {
  return <SkeletonGroup label="Loading home menu" active={active} testID="home-skeleton">
    <Categories home />
    <View style={s.homeContent}><SkeletonText width={132} lineHeight={16} />
      <View style={s.popularRow}>{[0, 1, 2].map(index => <SkeletonCard key={index} style={s.popularCard}>
        <SkeletonImage aspectRatio={1.5} /><View style={s.popularCopy}><SkeletonText lines={2} lineHeight={12} />
          <SkeletonText lines={2} lineHeight={10} /><SkeletonText width="56%" lineHeight={12} /><SkeletonBlock height={34} radius={8} />
        </View>
      </SkeletonCard>)}</View>
    </View>
  </SkeletonGroup>;
}

export function MenuSkeleton({ active }: ActiveProps) {
  return <SkeletonGroup label="Loading menu" active={active} testID="menu-skeleton">
    <Categories />
    <View style={s.menuContent}><View style={s.row}><SkeletonText width="52%" lineHeight={21} /><SkeletonBlock width={58} height={25} radius={12} /></View>
      <View style={s.menuGrid}>{[0, 1, 2, 3].map(index => <SkeletonCard key={index} style={s.menuItem}>
        <SkeletonImage height={112} /><SkeletonText lines={2} lineHeight={16} /><SkeletonText lines={2} lineHeight={12} />
        <View style={s.row}><SkeletonText width="40%" lineHeight={15} /><SkeletonBlock width="50%" height={32} /></View>
      </SkeletonCard>)}</View>
    </View>
  </SkeletonGroup>;
}

function SummaryAmounts() {
  return <View style={s.stack}>
    {[0, 1, 2].map(index => <View style={s.row} key={index}><SkeletonText width="40%" /><SkeletonText width="22%" /></View>)}
    <View style={s.divider} /><View style={s.row}><SkeletonText width="32%" lineHeight={18} /><SkeletonText width="28%" lineHeight={18} /></View>
  </View>;
}

export function CartSkeleton({ active }: ActiveProps) {
  return <SkeletonGroup label="Restoring cart" active={active} testID="cart-skeleton" style={s.cart}>
    <View style={s.stack}><View style={s.row}><SkeletonText width="18%" lineHeight={18} /><SkeletonBlock width="62%" height={36} radius={18} /></View>
      <SkeletonCard>{[0, 1].map(index => <View key={index} style={s.cartLine}>
        <View style={s.row}><SkeletonImage width={64} height={64} /><View style={s.flex}><SkeletonText width="82%" lineHeight={16} /><SkeletonText lines={2} lineHeight={12} /></View><SkeletonText width={48} /></View>
        <View style={s.row}><SkeletonBlock width={114} height={36} radius={18} /><SkeletonCircle size={32} /></View>
      </View>)}</SkeletonCard>
      <SkeletonCard><SkeletonText width="50%" lineHeight={18} /><SkeletonBlock height={44} /><View style={s.row}>{[0, 1, 2, 3].map(index => <SkeletonBlock key={index} width="22%" height={36} />)}</View>
        <SummaryAmounts /><SkeletonBlock height={52} radius={26} />
      </SkeletonCard>
    </View>
  </SkeletonGroup>;
}

function OrderRows({ count = 3 }: { count?: number }) {
  return <>{Array.from({ length: count }, (_, index) => <SkeletonCard key={index}>
    <View style={s.row}><SkeletonText width="46%" lineHeight={16} /><SkeletonBlock width={70} height={24} radius={12} /></View>
    <SkeletonText width="72%" lineHeight={12} /><View style={s.row}><SkeletonText width={64} /><SkeletonBlock width={94} height={36} radius={18} /></View>
  </SkeletonCard>)}</>;
}

function ProfileDetails() {
  return <SkeletonCard><SkeletonText width="42%" lineHeight={20} />
    {[0, 1, 2].map(index => <View key={index} style={s.field}><SkeletonText width={70} lineHeight={12} /><SkeletonBlock height={48} /></View>)}
    <SkeletonBlock height={46} radius={23} />
  </SkeletonCard>;
}

function ProfileOverview() {
  return <><SkeletonCard>
    <View style={s.row}><SkeletonText width="45%" lineHeight={16} /><SkeletonBlock width="30%" height={28} radius={14} /></View>
    <SkeletonText width="74%" lineHeight={22} /><SkeletonText lines={2} lineHeight={13} />
    <View style={s.row}><View style={s.flex}><SkeletonText width="70%" lineHeight={30} /><SkeletonText width="90%" lineHeight={12} /></View>
      <SkeletonCircle size={108} style={s.ring} /><View style={s.flex}><SkeletonText width="65%" lineHeight={30} /><SkeletonText width="95%" lineHeight={12} /></View></View>
    <View style={[s.row, { flexWrap: 'wrap', gap: 6 }]}>{Array.from({ length: 8 }, (_, index) => <SkeletonCircle key={index} size={22} />)}</View>
    <SkeletonText width="35%" lineHeight={12} />
  </SkeletonCard>
    <SkeletonText width="48%" lineHeight={18} /><OrderRows count={2} /></>;
}

export function ProfileSectionSkeleton({ section, active }: ActiveProps & { section: ProfileSkeletonSection }) {
  return <SkeletonGroup label={`Loading ${section === 'overview' ? 'account overview' : section}`} active={active} testID={`profile-${section}-skeleton`}>
    <View style={s.stack}>
      {section === 'overview' ? <ProfileOverview /> : section === 'profile' ? <ProfileDetails /> : section === 'orders' ? <>
        <SkeletonText width="50%" lineHeight={20} /><View style={s.row}><SkeletonBlock width="48%" height={38} radius={19} /><SkeletonBlock width="48%" height={38} radius={19} /></View><OrderRows />
      </> : section === 'addresses' ? <>
        <View style={s.row}><SkeletonText width="45%" lineHeight={20} /><SkeletonCircle size={36} /></View>
        {[0, 1].map(index => <SkeletonCard key={index}><View style={s.row}><SkeletonText width="45%" lineHeight={16} /><SkeletonCircle size={26} /></View><SkeletonText lines={3} lineHeight={13} /><View style={s.row}><SkeletonBlock width={76} height={32} /><SkeletonCircle size={26} /></View></SkeletonCard>)}
      </> : <>
        <SkeletonCard><SkeletonText width="40%" lineHeight={20} /><SkeletonText lines={2} /><SkeletonBlock width="55%" height={44} radius={22} /></SkeletonCard>
        {[0, 1].map(index => <SkeletonCard key={index}><View style={s.row}><SkeletonText width="58%" lineHeight={16} /><SkeletonBlock width={64} height={24} radius={12} /></View><SkeletonText lines={2} /><SkeletonText width="35%" lineHeight={11} /></SkeletonCard>)}
      </>}
    </View>
  </SkeletonGroup>;
}

/** Public placeholders only, used while the Profile auth guard resolves identity. */
export function ProfileSkeleton({ active, section = 'profile' }: ActiveProps & { section?: ProfileSkeletonSection }) {
  return <View style={s.profilePage}><SkeletonGroup label="Loading profile" active={active} testID="profile-header-skeleton">
    <View style={s.profileHeader}><SkeletonText width={174} lineHeight={22} /><SkeletonBlock width={134} height={28} radius={14} /></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 16 }}>{[0, 1, 2, 3, 4].map(index => <SkeletonBlock key={index} width={76} height={38} radius={19} />)}</ScrollView>
    <ProfileSectionSkeleton section={section} />
  </SkeletonGroup></View>;
}

export function OrdersPaginationSkeleton({ active }: ActiveProps) {
  return <SkeletonGroup label="Loading more orders" active={active} testID="orders-pagination-skeleton" style={s.pagination}><OrderRows count={1} /></SkeletonGroup>;
}

export function OrderDetailSkeleton({ active }: ActiveProps) {
  return <SkeletonGroup label="Loading order details" active={active} testID="order-detail-skeleton" style={s.orderDetail}>
    <View style={s.stack}>
      <SkeletonText width={128} lineHeight={14} />
      <View style={s.orderHero}><SkeletonText width="42%" lineHeight={12} /><SkeletonBlock width="76%" height={28} /><SkeletonBlock height={48} radius={24} /></View>
      <View style={s.row}><SkeletonBlock width="26%" height={34} /><SkeletonBlock width="68%" height={34} /></View>
      <SkeletonBlock height={44} />
      <SkeletonCard><SkeletonText width="30%" lineHeight={18} />{[0, 1].map(index => <View key={index} style={s.row}><View style={s.flex}><SkeletonText width="78%" lineHeight={16} /><SkeletonText lines={2} lineHeight={12} /></View><SkeletonText width={56} /></View>)}
        <View style={s.summaryInset}><SummaryAmounts /></View>
        <View style={s.statusInset}><SkeletonText width="40%" lineHeight={12} /><View style={s.row}><SkeletonCircle size={16} /><View style={s.flex}><SkeletonText width="60%" /><SkeletonText width="42%" lineHeight={11} /></View></View></View>
      </SkeletonCard>
    </View>
  </SkeletonGroup>;
}

const s = StyleSheet.create({
  stack: { gap: 16 }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  flex: { flex: 1, minWidth: 0, gap: 8 }, categories: { paddingHorizontal: 20, paddingVertical: 18, gap: 8 }, category: { alignItems: 'center', gap: 7 },
  homeContent: { paddingHorizontal: 16, gap: 8 }, popularRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  popularCard: { flex: 1, minWidth: 0, padding: 0, gap: 0, overflow: 'hidden', borderRadius: 12 }, popularCopy: { padding: 7, gap: 8 },
  menuContent: { paddingHorizontal: 20, gap: 14 }, menuGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  menuItem: { width: '48%', minHeight: 250, padding: 8, gap: 10 }, cart: { width: '100%', paddingTop: 8 }, cartLine: { gap: 12, paddingVertical: 8 },
  divider: { height: 1, backgroundColor: '#EFE4DE' }, field: { gap: 8 }, ring: { backgroundColor: 'transparent', borderWidth: 12, borderColor: '#EAEAEA' },
  profilePage: { flex: 1, padding: 20, backgroundColor: '#FFF9F5' }, profileHeader: { paddingVertical: 20, alignItems: 'center', gap: 8 },
  pagination: { marginTop: 14 }, orderDetail: { padding: 16 }, orderHero: { borderRadius: 18, padding: 18, backgroundColor: '#252525', gap: 14 },
  summaryInset: { backgroundColor: '#F6F6F6', padding: 12, borderRadius: 14 },
  statusInset: { borderWidth: 1, borderColor: '#E9D8D1', borderRadius: 14, padding: 14, gap: 12 },
});
