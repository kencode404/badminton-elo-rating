// Hand-written DB types. Keep in sync with supabase/migrations/0001_init.sql.
// You can later replace this with `supabase gen types typescript` output.

export type MatchType = 'singles' | 'doubles';
export type MatchStatus = 'pending' | 'confirmed' | 'rejected' | 'expired';
export type Team = 'A' | 'B';
export type Confirmation = 'pending' | 'accepted' | 'rejected';

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
          created_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          avatar_url?: string | null;
          singles_rating?: number;
          doubles_rating?: number;
          singles_games_played?: number;
          doubles_games_played?: number;
        };
        Update: {
          display_name?: string;
          avatar_url?: string | null;
          singles_rating?: number;
          doubles_rating?: number;
          singles_games_played?: number;
          doubles_games_played?: number;
        };
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
    Functions: Record<string, never>;
    Enums: {
      match_type: MatchType;
      match_status: MatchStatus;
      match_team: Team;
      confirmation_status: Confirmation;
    };
    CompositeTypes: Record<string, never>;
  };
}
