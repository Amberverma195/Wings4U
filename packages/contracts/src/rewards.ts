/** Customer rewards summary. Capacity and the cost of one reward are distinct. */
export interface WingsRewardsSummary {
  customer_user_id: string;
  available_stamps: number;
  lifetime_stamps: number;
  lifetime_redemptions: number;
  stamps_per_reward: number;
  max_available_stamps: number;
  reward_available: boolean;
  updated_at: string;
}
