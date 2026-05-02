// Hand-written DB types. Keep in sync with supabase/migrations/0001_init.sql.
// You can later replace this with `supabase gen types typescript` output.

export type MatchType = 'singles' | 'doubles';
export type MatchStatus = 'pending' | 'confirmed' | 'rejected' | 'expired';
export type Team = 'A' | 'B';
export type Confirmation = 'pending' | 'accepted' | 'rejected';
export type ChatMessageKind =
  | 'system_streak'
  | 'system_tier_up'
  | 'system_streak_ended'
  | 'user';

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          avatar_url: string | null;
          singles_rating: number;
          doubles_rating: number;
          singles_games_played: number;
          doubles_games_played: number;
          peak_singles_rating: number;
          peak_doubles_rating: number;
          created_at: string;
          chat_last_seen_at: string;
          is_admin: boolean;
        };
        Insert: {
          id: string;
          display_name: string;
          avatar_url?: string | null;
          singles_rating?: number;
          doubles_rating?: number;
          singles_games_played?: number;
          doubles_games_played?: number;
          peak_singles_rating?: number;
          peak_doubles_rating?: number;
          chat_last_seen_at?: string;
          is_admin?: boolean;
        };
        Update: {
          display_name?: string;
          avatar_url?: string | null;
          singles_rating?: number;
          doubles_rating?: number;
          singles_games_played?: number;
          doubles_games_played?: number;
          peak_singles_rating?: number;
          peak_doubles_rating?: number;
          chat_last_seen_at?: string;
          is_admin?: boolean;
        };
        Relationships: [];
      };
      season_snapshots: {
        Row: {
          user_id: string;
          season_number: number;
          archived_at: string;
          singles_rating: number;
          doubles_rating: number;
          singles_games_played: number;
          doubles_games_played: number;
          singles_wins: number;
          doubles_wins: number;
          singles_rank: number | null;
          doubles_rank: number | null;
        };
        Insert: {
          user_id: string;
          season_number: number;
          singles_rating: number;
          doubles_rating: number;
          singles_games_played: number;
          doubles_games_played: number;
          singles_wins: number;
          doubles_wins: number;
          singles_rank?: number | null;
          doubles_rank?: number | null;
          archived_at?: string;
        };
        Update: never;
        Relationships: [];
      };
      matches: {
        Row: {
          id: string;
          match_type: MatchType;
          created_by: string;
          score_a: number;
          score_b: number;
          status: MatchStatus;
          played_at: string;
          confirmed_at: string | null;
          expires_at: string;
          elo_version: number;
        };
        Insert: {
          id?: string;
          match_type: MatchType;
          created_by: string;
          score_a: number;
          score_b: number;
          status?: MatchStatus;
          played_at?: string;
          expires_at?: string;
          elo_version?: number;
        };
        Update: {
          match_type?: MatchType;
          score_a?: number;
          score_b?: number;
          status?: MatchStatus;
          confirmed_at?: string | null;
          expires_at?: string;
        };
        Relationships: [];
      };
      chat_messages: {
        Row: {
          id: string;
          kind: ChatMessageKind;
          user_id: string;
          body: string | null;
          match_type: MatchType | null;
          streak_count: number | null;
          tier_key: string | null;
          breaker_user_ids: string[] | null;
          created_at: string;
          expires_at: string | null;
        };
        Insert: {
          id?: string;
          kind: ChatMessageKind;
          user_id: string;
          body?: string | null;
          match_type?: MatchType | null;
          streak_count?: number | null;
          tier_key?: string | null;
          breaker_user_ids?: string[] | null;
          created_at?: string;
          expires_at?: string | null;
        };
        Update: {
          body?: string | null;
          expires_at?: string | null;
        };
        Relationships: [];
      };
      chat_reactions: {
        Row: {
          message_id: string;
          user_id: string;
          emoji: string;
          created_at: string;
        };
        Insert: {
          message_id: string;
          user_id: string;
          emoji: string;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
      match_participants: {
        Row: {
          match_id: string;
          user_id: string;
          team: Team;
          confirmation: Confirmation;
          responded_at: string | null;
          rating_before: number | null;
          rating_after: number | null;
          rating_delta: number | null;
        };
        Insert: {
          match_id: string;
          user_id: string;
          team: Team;
          confirmation?: Confirmation;
        };
        Update: {
          confirmation?: Confirmation;
          responded_at?: string | null;
          rating_before?: number | null;
          rating_after?: number | null;
          rating_delta?: number | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_user_win_counts: {
        Args: { p_user_id: string };
        Returns: { singles_wins: number; doubles_wins: number }[];
      };
      get_recent_matches: {
        Args: { p_user_id: string; p_limit?: number };
        Returns: {
          match_id: string;
          match_type: MatchType;
          played_at: string;
          user_team: Team;
          score_a: number;
          score_b: number;
          rating_delta: number | null;
          others: Array<{ user_id: string; display_name: string; team: Team }>;
        }[];
      };
      reset_season: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      get_win_streaks: {
        Args: Record<PropertyKey, never>;
        Returns: {
          user_id: string;
          singles_streak: number;
          doubles_streak: number;
        }[];
      };
      is_match_participant: {
        Args: { p_match_id: string; p_user_id: string };
        Returns: boolean;
      };
    };
    Enums: {
      match_type: MatchType;
      match_status: MatchStatus;
      match_team: Team;
      confirmation_status: Confirmation;
      chat_message_kind: ChatMessageKind;
    };
    CompositeTypes: Record<string, never>;
  };
}
