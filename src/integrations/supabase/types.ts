export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      backtest_runs: {
        Row: {
          completed_at: string | null
          engine_source: string | null
          equity_curve: Json | null
          error: string | null
          experiment_id: string | null
          id: string
          metrics: Json | null
          notes: string | null
          params: Json | null
          raw_results_url: string | null
          regime_context: Json | null
          regime_id: number | null
          session_id: string | null
          started_at: string | null
          statistical_validity: Json | null
          status: string
          strategy_key: string
        }
        Insert: {
          completed_at?: string | null
          engine_source?: string | null
          equity_curve?: Json | null
          error?: string | null
          experiment_id?: string | null
          id?: string
          metrics?: Json | null
          notes?: string | null
          params?: Json | null
          raw_results_url?: string | null
          regime_context?: Json | null
          regime_id?: number | null
          session_id?: string | null
          started_at?: string | null
          statistical_validity?: Json | null
          status?: string
          strategy_key: string
        }
        Update: {
          completed_at?: string | null
          engine_source?: string | null
          equity_curve?: Json | null
          error?: string | null
          experiment_id?: string | null
          id?: string
          metrics?: Json | null
          notes?: string | null
          params?: Json | null
          raw_results_url?: string | null
          regime_context?: Json | null
          regime_id?: number | null
          session_id?: string | null
          started_at?: string | null
          statistical_validity?: Json | null
          status?: string
          strategy_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "backtest_runs_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "backtest_runs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_sessions: {
        Row: {
          created_at: string | null
          id: string
          metadata: Json | null
          title: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          metadata?: Json | null
          title: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          metadata?: Json | null
          title?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      experiment_checkpoints: {
        Row: {
          created_at: string | null
          experiment_id: string | null
          id: string
          notes: string
          run_count: number | null
          session_id: string
          snapshot_data: Json | null
        }
        Insert: {
          created_at?: string | null
          experiment_id?: string | null
          id?: string
          notes: string
          run_count?: number | null
          session_id: string
          snapshot_data?: Json | null
        }
        Update: {
          created_at?: string | null
          experiment_id?: string | null
          id?: string
          notes?: string
          run_count?: number | null
          session_id?: string
          snapshot_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "experiment_checkpoints_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
        ]
      }
      experiments: {
        Row: {
          completed_at: string | null
          created_at: string | null
          description: string | null
          id: string
          name: string
          session_id: string
          status: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          session_id: string
          status?: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          session_id?: string
          status?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "experiments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      graduation_tracker: {
        Row: {
          avg_fill_latency_ms: number | null
          avg_slippage_cost: number | null
          created_at: string | null
          evaluation_notes: string | null
          graduation_date: string | null
          graduation_threshold_met: boolean | null
          id: string
          last_evaluation_at: string | null
          max_allowed_drawdown: number | null
          partial_fill_rate: number | null
          regime_distribution: Json | null
          rejection_rate: number | null
          required_sharpe: number | null
          required_trade_count: number | null
          required_win_rate: number | null
          shadow_max_drawdown: number | null
          shadow_profit_factor: number | null
          shadow_sharpe: number | null
          shadow_sortino: number | null
          shadow_total_pnl: number | null
          shadow_trade_count: number | null
          shadow_win_rate: number | null
          status: Database["public"]["Enums"]["graduation_status"] | null
          strategy_id: string
          updated_at: string | null
        }
        Insert: {
          avg_fill_latency_ms?: number | null
          avg_slippage_cost?: number | null
          created_at?: string | null
          evaluation_notes?: string | null
          graduation_date?: string | null
          graduation_threshold_met?: boolean | null
          id?: string
          last_evaluation_at?: string | null
          max_allowed_drawdown?: number | null
          partial_fill_rate?: number | null
          regime_distribution?: Json | null
          rejection_rate?: number | null
          required_sharpe?: number | null
          required_trade_count?: number | null
          required_win_rate?: number | null
          shadow_max_drawdown?: number | null
          shadow_profit_factor?: number | null
          shadow_sharpe?: number | null
          shadow_sortino?: number | null
          shadow_total_pnl?: number | null
          shadow_trade_count?: number | null
          shadow_win_rate?: number | null
          status?: Database["public"]["Enums"]["graduation_status"] | null
          strategy_id: string
          updated_at?: string | null
        }
        Update: {
          avg_fill_latency_ms?: number | null
          avg_slippage_cost?: number | null
          created_at?: string | null
          evaluation_notes?: string | null
          graduation_date?: string | null
          graduation_threshold_met?: boolean | null
          id?: string
          last_evaluation_at?: string | null
          max_allowed_drawdown?: number | null
          partial_fill_rate?: number | null
          regime_distribution?: Json | null
          rejection_rate?: number | null
          required_sharpe?: number | null
          required_trade_count?: number | null
          required_win_rate?: number | null
          shadow_max_drawdown?: number | null
          shadow_profit_factor?: number | null
          shadow_sharpe?: number | null
          shadow_sortino?: number | null
          shadow_total_pnl?: number | null
          shadow_trade_count?: number | null
          shadow_win_rate?: number | null
          status?: Database["public"]["Enums"]["graduation_status"] | null
          strategy_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "graduation_tracker_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: true
            referencedRelation: "strategy_genome"
            referencedColumns: ["id"]
          },
        ]
      }
      local_data_index: {
        Row: {
          data_type: string
          date: string
          downloaded_at: string | null
          file_path: string
          id: string
          is_complete: boolean | null
          last_accessed: string | null
          quality_flags: Json | null
          row_count: number | null
          size_bytes: number | null
          source: string | null
          source_file: string | null
          symbol: string
        }
        Insert: {
          data_type: string
          date: string
          downloaded_at?: string | null
          file_path: string
          id?: string
          is_complete?: boolean | null
          last_accessed?: string | null
          quality_flags?: Json | null
          row_count?: number | null
          size_bytes?: number | null
          source?: string | null
          source_file?: string | null
          symbol: string
        }
        Update: {
          data_type?: string
          date?: string
          downloaded_at?: string | null
          file_path?: string
          id?: string
          is_complete?: boolean | null
          last_accessed?: string | null
          quality_flags?: Json | null
          row_count?: number | null
          size_bytes?: number | null
          source?: string | null
          source_file?: string | null
          symbol?: string
        }
        Relationships: []
      }
      market_events: {
        Row: {
          created_at: string | null
          description: string | null
          embedding: string | null
          end_date: string
          event_name: string
          event_type: string
          id: string
          losing_profiles: number[] | null
          memory_ids: string[] | null
          peak_date: string | null
          primary_regime: number | null
          regime_sequence: number[] | null
          spx_drawdown: number | null
          start_date: string
          vix_avg: number | null
          vix_peak: number | null
          winning_profiles: number[] | null
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          embedding?: string | null
          end_date: string
          event_name: string
          event_type: string
          id?: string
          losing_profiles?: number[] | null
          memory_ids?: string[] | null
          peak_date?: string | null
          primary_regime?: number | null
          regime_sequence?: number[] | null
          spx_drawdown?: number | null
          start_date: string
          vix_avg?: number | null
          vix_peak?: number | null
          winning_profiles?: number[] | null
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          embedding?: string | null
          end_date?: string
          event_name?: string
          event_type?: string
          id?: string
          losing_profiles?: number[] | null
          memory_ids?: string[] | null
          peak_date?: string | null
          primary_regime?: number | null
          regime_sequence?: number[] | null
          spx_drawdown?: number | null
          start_date?: string
          vix_avg?: number | null
          vix_peak?: number | null
          winning_profiles?: number[] | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      memories: {
        Row: {
          access_count: number | null
          archived: boolean | null
          category: string | null
          confidence: number | null
          content: string
          content_tsvector: unknown
          contradicts: string[] | null
          created_at: string | null
          decay_factor: number | null
          embedding: string | null
          embedding_model: string | null
          entities: Json | null
          financial_impact: number | null
          id: string
          immutable: boolean | null
          importance_score: number | null
          last_accessed: string | null
          last_recalled_at: string | null
          market_conditions: Json | null
          memory_type: string
          outcome: Json | null
          protection_level: number | null
          regime_context: Json | null
          related_memories: string[] | null
          session_id: string | null
          source: string | null
          strategies: string[] | null
          summary: string | null
          supersedes: string[] | null
          symbols: string[] | null
          tags: string[] | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          access_count?: number | null
          archived?: boolean | null
          category?: string | null
          confidence?: number | null
          content: string
          content_tsvector?: unknown
          contradicts?: string[] | null
          created_at?: string | null
          decay_factor?: number | null
          embedding?: string | null
          embedding_model?: string | null
          entities?: Json | null
          financial_impact?: number | null
          id?: string
          immutable?: boolean | null
          importance_score?: number | null
          last_accessed?: string | null
          last_recalled_at?: string | null
          market_conditions?: Json | null
          memory_type: string
          outcome?: Json | null
          protection_level?: number | null
          regime_context?: Json | null
          related_memories?: string[] | null
          session_id?: string | null
          source?: string | null
          strategies?: string[] | null
          summary?: string | null
          supersedes?: string[] | null
          symbols?: string[] | null
          tags?: string[] | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          access_count?: number | null
          archived?: boolean | null
          category?: string | null
          confidence?: number | null
          content?: string
          content_tsvector?: unknown
          contradicts?: string[] | null
          created_at?: string | null
          decay_factor?: number | null
          embedding?: string | null
          embedding_model?: string | null
          entities?: Json | null
          financial_impact?: number | null
          id?: string
          immutable?: boolean | null
          importance_score?: number | null
          last_accessed?: string | null
          last_recalled_at?: string | null
          market_conditions?: Json | null
          memory_type?: string
          outcome?: Json | null
          protection_level?: number | null
          regime_context?: Json | null
          related_memories?: string[] | null
          session_id?: string | null
          source?: string | null
          strategies?: string[] | null
          summary?: string | null
          supersedes?: string[] | null
          symbols?: string[] | null
          tags?: string[] | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memories_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      memory_evidence: {
        Row: {
          captured_at: string | null
          evidence_data: Json | null
          evidence_hash: string | null
          evidence_path: string | null
          evidence_type: string
          id: string
          memory_id: string
          notes: string | null
        }
        Insert: {
          captured_at?: string | null
          evidence_data?: Json | null
          evidence_hash?: string | null
          evidence_path?: string | null
          evidence_type: string
          id?: string
          memory_id: string
          notes?: string | null
        }
        Update: {
          captured_at?: string | null
          evidence_data?: Json | null
          evidence_hash?: string | null
          evidence_path?: string | null
          evidence_type?: string
          id?: string
          memory_id?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "memory_evidence_memory_id_fkey"
            columns: ["memory_id"]
            isOneToOne: false
            referencedRelation: "memories"
            referencedColumns: ["id"]
          },
        ]
      }
      memory_extraction_state: {
        Row: {
          extraction_metadata: Json | null
          last_extraction_time: string | null
          last_processed_message_id: string | null
          session_id: string
          total_extracted: number | null
          workspace_id: string | null
        }
        Insert: {
          extraction_metadata?: Json | null
          last_extraction_time?: string | null
          last_processed_message_id?: string | null
          session_id: string
          total_extracted?: number | null
          workspace_id?: string | null
        }
        Update: {
          extraction_metadata?: Json | null
          last_extraction_time?: string | null
          last_processed_message_id?: string | null
          session_id?: string
          total_extracted?: number | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "memory_extraction_state_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      memory_notes_old: {
        Row: {
          archived: boolean | null
          content: string
          created_at: string | null
          embedding: string | null
          id: string
          importance: string | null
          memory_type: string | null
          metadata: Json | null
          run_id: string | null
          source: string
          tags: string[] | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          archived?: boolean | null
          content: string
          created_at?: string | null
          embedding?: string | null
          id?: string
          importance?: string | null
          memory_type?: string | null
          metadata?: Json | null
          run_id?: string | null
          source?: string
          tags?: string[] | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          archived?: boolean | null
          content?: string
          created_at?: string | null
          embedding?: string | null
          id?: string
          importance?: string | null
          memory_type?: string | null
          metadata?: Json | null
          run_id?: string | null
          source?: string
          tags?: string[] | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memory_notes_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "backtest_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memory_notes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      memory_queries: {
        Row: {
          created_at: string | null
          expanded_queries: string[] | null
          id: string
          query: string
          relevance_scores: number[] | null
          response_time_ms: number | null
          returned_memory_ids: string[] | null
          used_reranking: boolean | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string | null
          expanded_queries?: string[] | null
          id?: string
          query: string
          relevance_scores?: number[] | null
          response_time_ms?: number | null
          returned_memory_ids?: string[] | null
          used_reranking?: boolean | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string | null
          expanded_queries?: string[] | null
          id?: string
          query?: string
          relevance_scores?: number[] | null
          response_time_ms?: number | null
          returned_memory_ids?: string[] | null
          used_reranking?: boolean | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "memory_queries_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          created_at: string | null
          id: string
          model: string | null
          provider: string | null
          role: string
          session_id: string
          token_usage: Json | null
          tool_calls: Json | null
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          model?: string | null
          provider?: string | null
          role: string
          session_id: string
          token_usage?: Json | null
          tool_calls?: Json | null
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          model?: string | null
          provider?: string | null
          role?: string
          session_id?: string
          token_usage?: Json | null
          tool_calls?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      morning_briefings: {
        Row: {
          created_at: string | null
          headline: string
          id: string
          key_metrics: Json | null
          narrative: string
          priority_score: number | null
          read: boolean | null
          read_at: string | null
          reviewed_at: string | null
          strategy_id: string
          user_feedback: string | null
          verdict: Database["public"]["Enums"]["briefing_verdict"] | null
        }
        Insert: {
          created_at?: string | null
          headline: string
          id?: string
          key_metrics?: Json | null
          narrative: string
          priority_score?: number | null
          read?: boolean | null
          read_at?: string | null
          reviewed_at?: string | null
          strategy_id: string
          user_feedback?: string | null
          verdict?: Database["public"]["Enums"]["briefing_verdict"] | null
        }
        Update: {
          created_at?: string | null
          headline?: string
          id?: string
          key_metrics?: Json | null
          narrative?: string
          priority_score?: number | null
          read?: boolean | null
          read_at?: string | null
          reviewed_at?: string | null
          strategy_id?: string
          user_feedback?: string | null
          verdict?: Database["public"]["Enums"]["briefing_verdict"] | null
        }
        Relationships: [
          {
            foreignKeyName: "morning_briefings_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategy_genome"
            referencedColumns: ["id"]
          },
        ]
      }
      overfitting_warnings: {
        Row: {
          approach_description: string
          created_at: string | null
          deflated_sharpe: number | null
          do_not_repeat: string | null
          evidence_detail: string
          failure_type: string
          id: string
          in_sample_sharpe: number | null
          num_variations_tested: number | null
          out_of_sample_sharpe: number | null
          parameter_space: Json | null
          pbo_score: number | null
          run_id: string | null
          strategy_embedding: string | null
          strategy_name: string
          walk_forward_efficiency: number | null
          warning_message: string
          workspace_id: string
        }
        Insert: {
          approach_description: string
          created_at?: string | null
          deflated_sharpe?: number | null
          do_not_repeat?: string | null
          evidence_detail: string
          failure_type: string
          id?: string
          in_sample_sharpe?: number | null
          num_variations_tested?: number | null
          out_of_sample_sharpe?: number | null
          parameter_space?: Json | null
          pbo_score?: number | null
          run_id?: string | null
          strategy_embedding?: string | null
          strategy_name: string
          walk_forward_efficiency?: number | null
          warning_message: string
          workspace_id: string
        }
        Update: {
          approach_description?: string
          created_at?: string | null
          deflated_sharpe?: number | null
          do_not_repeat?: string | null
          evidence_detail?: string
          failure_type?: string
          id?: string
          in_sample_sharpe?: number | null
          num_variations_tested?: number | null
          out_of_sample_sharpe?: number | null
          parameter_space?: Json | null
          pbo_score?: number | null
          run_id?: string | null
          strategy_embedding?: string | null
          strategy_name?: string
          walk_forward_efficiency?: number | null
          warning_message?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "overfitting_warnings_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "backtest_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "overfitting_warnings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      regime_profile_performance: {
        Row: {
          avg_cagr: number | null
          avg_max_drawdown: number | null
          avg_sharpe: number | null
          confidence_score: number | null
          first_observed: string | null
          id: string
          last_updated: string | null
          p_value: number | null
          profile_id: number
          regime_id: number
          run_ids: string[] | null
          t_statistic: number | null
          total_runs: number | null
          total_trades: number | null
          win_rate: number | null
          workspace_id: string
        }
        Insert: {
          avg_cagr?: number | null
          avg_max_drawdown?: number | null
          avg_sharpe?: number | null
          confidence_score?: number | null
          first_observed?: string | null
          id?: string
          last_updated?: string | null
          p_value?: number | null
          profile_id: number
          regime_id: number
          run_ids?: string[] | null
          t_statistic?: number | null
          total_runs?: number | null
          total_trades?: number | null
          win_rate?: number | null
          workspace_id: string
        }
        Update: {
          avg_cagr?: number | null
          avg_max_drawdown?: number | null
          avg_sharpe?: number | null
          confidence_score?: number | null
          first_observed?: string | null
          id?: string
          last_updated?: string | null
          p_value?: number | null
          profile_id?: number
          regime_id?: number
          run_ids?: string[] | null
          t_statistic?: number | null
          total_runs?: number | null
          total_trades?: number | null
          win_rate?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "regime_profile_performance_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      research_reports: {
        Row: {
          content: string
          created_at: string
          id: string
          scope: string | null
          session_id: string | null
          summary: string
          tags: string[] | null
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          scope?: string | null
          session_id?: string | null
          summary: string
          tags?: string[] | null
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          scope?: string | null
          session_id?: string | null
          summary?: string
          tags?: string[] | null
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_reports_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_reports_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      shadow_positions: {
        Row: {
          closed_at: string | null
          created_at: string | null
          current_ask: number | null
          current_bid: number | null
          current_pnl: number | null
          current_pnl_pct: number | null
          current_price: number | null
          current_regime: string | null
          entry_ask: number | null
          entry_bid: number | null
          entry_metadata: Json | null
          entry_price: number
          entry_time: string
          expiry: string | null
          id: string
          is_open: boolean | null
          max_adverse_excursion: number | null
          max_favorable_excursion: number | null
          option_type: string | null
          quantity: number
          regime_at_entry: string | null
          side: Database["public"]["Enums"]["position_side"]
          strategy_id: string
          strike: number | null
          symbol: string
          time_in_position_seconds: number | null
          unrealized_slippage: number | null
          updated_at: string | null
        }
        Insert: {
          closed_at?: string | null
          created_at?: string | null
          current_ask?: number | null
          current_bid?: number | null
          current_pnl?: number | null
          current_pnl_pct?: number | null
          current_price?: number | null
          current_regime?: string | null
          entry_ask?: number | null
          entry_bid?: number | null
          entry_metadata?: Json | null
          entry_price: number
          entry_time: string
          expiry?: string | null
          id?: string
          is_open?: boolean | null
          max_adverse_excursion?: number | null
          max_favorable_excursion?: number | null
          option_type?: string | null
          quantity: number
          regime_at_entry?: string | null
          side: Database["public"]["Enums"]["position_side"]
          strategy_id: string
          strike?: number | null
          symbol: string
          time_in_position_seconds?: number | null
          unrealized_slippage?: number | null
          updated_at?: string | null
        }
        Update: {
          closed_at?: string | null
          created_at?: string | null
          current_ask?: number | null
          current_bid?: number | null
          current_pnl?: number | null
          current_pnl_pct?: number | null
          current_price?: number | null
          current_regime?: string | null
          entry_ask?: number | null
          entry_bid?: number | null
          entry_metadata?: Json | null
          entry_price?: number
          entry_time?: string
          expiry?: string | null
          id?: string
          is_open?: boolean | null
          max_adverse_excursion?: number | null
          max_favorable_excursion?: number | null
          option_type?: string | null
          quantity?: number
          regime_at_entry?: string | null
          side?: Database["public"]["Enums"]["position_side"]
          strategy_id?: string
          strike?: number | null
          symbol?: string
          time_in_position_seconds?: number | null
          unrealized_slippage?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shadow_positions_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategy_genome"
            referencedColumns: ["id"]
          },
        ]
      }
      shadow_trades: {
        Row: {
          created_at: string | null
          duration_seconds: number | null
          entry_ask: number | null
          entry_bid: number | null
          entry_price: number
          entry_time: string | null
          execution_metadata: Json | null
          exit_ask: number | null
          exit_bid: number | null
          exit_price: number | null
          exit_time: string | null
          expiry: string | null
          fill_latency_ms: number | null
          fill_type: string | null
          id: string
          max_adverse_excursion: number | null
          max_favorable_excursion: number | null
          option_type: string | null
          pnl: number | null
          pnl_percent: number | null
          quantity: number
          regime_at_entry: string | null
          regime_at_exit: string | null
          side: string
          signal_time: string
          slippage_cost: number | null
          strategy_id: string
          strike: number | null
          symbol: string
        }
        Insert: {
          created_at?: string | null
          duration_seconds?: number | null
          entry_ask?: number | null
          entry_bid?: number | null
          entry_price: number
          entry_time?: string | null
          execution_metadata?: Json | null
          exit_ask?: number | null
          exit_bid?: number | null
          exit_price?: number | null
          exit_time?: string | null
          expiry?: string | null
          fill_latency_ms?: number | null
          fill_type?: string | null
          id?: string
          max_adverse_excursion?: number | null
          max_favorable_excursion?: number | null
          option_type?: string | null
          pnl?: number | null
          pnl_percent?: number | null
          quantity: number
          regime_at_entry?: string | null
          regime_at_exit?: string | null
          side: string
          signal_time: string
          slippage_cost?: number | null
          strategy_id: string
          strike?: number | null
          symbol: string
        }
        Update: {
          created_at?: string | null
          duration_seconds?: number | null
          entry_ask?: number | null
          entry_bid?: number | null
          entry_price?: number
          entry_time?: string | null
          execution_metadata?: Json | null
          exit_ask?: number | null
          exit_bid?: number | null
          exit_price?: number | null
          exit_time?: string | null
          expiry?: string | null
          fill_latency_ms?: number | null
          fill_type?: string | null
          id?: string
          max_adverse_excursion?: number | null
          max_favorable_excursion?: number | null
          option_type?: string | null
          pnl?: number | null
          pnl_percent?: number | null
          quantity?: number
          regime_at_entry?: string | null
          regime_at_exit?: string | null
          side?: string
          signal_time?: string
          slippage_cost?: number | null
          strategy_id?: string
          strike?: number | null
          symbol?: string
        }
        Relationships: [
          {
            foreignKeyName: "shadow_trades_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategy_genome"
            referencedColumns: ["id"]
          },
        ]
      }
      strategies: {
        Row: {
          active: boolean | null
          config: Json | null
          created_at: string | null
          description: string | null
          id: string
          key: string
          name: string
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          config?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string
          key: string
          name: string
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          config?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string
          key?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      strategy_genome: {
        Row: {
          cagr: number | null
          children_spawned: number | null
          code_content: string | null
          code_hash: string | null
          created_at: string | null
          dna_config: Json
          fitness_score: number | null
          generation: number | null
          id: string
          max_drawdown: number | null
          metadata: Json | null
          mutations_tried: number | null
          name: string
          parent_id: string | null
          profit_factor: number | null
          promoted_at: string | null
          sharpe_ratio: number | null
          sortino_ratio: number | null
          status: Database["public"]["Enums"]["strategy_status"] | null
          tested_at: string | null
          updated_at: string | null
          win_rate: number | null
        }
        Insert: {
          cagr?: number | null
          children_spawned?: number | null
          code_content?: string | null
          code_hash?: string | null
          created_at?: string | null
          dna_config?: Json
          fitness_score?: number | null
          generation?: number | null
          id?: string
          max_drawdown?: number | null
          metadata?: Json | null
          mutations_tried?: number | null
          name: string
          parent_id?: string | null
          profit_factor?: number | null
          promoted_at?: string | null
          sharpe_ratio?: number | null
          sortino_ratio?: number | null
          status?: Database["public"]["Enums"]["strategy_status"] | null
          tested_at?: string | null
          updated_at?: string | null
          win_rate?: number | null
        }
        Update: {
          cagr?: number | null
          children_spawned?: number | null
          code_content?: string | null
          code_hash?: string | null
          created_at?: string | null
          dna_config?: Json
          fitness_score?: number | null
          generation?: number | null
          id?: string
          max_drawdown?: number | null
          metadata?: Json | null
          mutations_tried?: number | null
          name?: string
          parent_id?: string | null
          profit_factor?: number | null
          promoted_at?: string | null
          sharpe_ratio?: number | null
          sortino_ratio?: number | null
          status?: Database["public"]["Enums"]["strategy_status"] | null
          tested_at?: string | null
          updated_at?: string | null
          win_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "strategy_genome_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "strategy_genome"
            referencedColumns: ["id"]
          },
        ]
      }
      swarm_jobs: {
        Row: {
          agent_count: number
          completed_at: string | null
          config: Json | null
          created_at: string
          created_by: string | null
          error_message: string | null
          id: string
          mode: string
          objective: string
          progress_pct: number | null
          retry_count: number | null
          shared_context: Json | null
          started_at: string | null
          status: Database["public"]["Enums"]["swarm_status"]
          synthesis_metadata: Json | null
          synthesis_result: string | null
          tags: string[] | null
          workspace_id: string | null
        }
        Insert: {
          agent_count?: number
          completed_at?: string | null
          config?: Json | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          mode?: string
          objective: string
          progress_pct?: number | null
          retry_count?: number | null
          shared_context?: Json | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["swarm_status"]
          synthesis_metadata?: Json | null
          synthesis_result?: string | null
          tags?: string[] | null
          workspace_id?: string | null
        }
        Update: {
          agent_count?: number
          completed_at?: string | null
          config?: Json | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          mode?: string
          objective?: string
          progress_pct?: number | null
          retry_count?: number | null
          shared_context?: Json | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["swarm_status"]
          synthesis_metadata?: Json | null
          synthesis_result?: string | null
          tags?: string[] | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "swarm_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      swarm_tasks: {
        Row: {
          agent_index: number
          agent_role: string
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          input_context: string
          input_metadata: Json | null
          job_id: string
          latency_ms: number | null
          model_used: string | null
          output_content: string | null
          output_metadata: Json | null
          retry_count: number | null
          shared_context: Json | null
          started_at: string | null
          status: Database["public"]["Enums"]["swarm_status"]
          tokens_input: number | null
          tokens_output: number | null
          worker_id: string | null
        }
        Insert: {
          agent_index: number
          agent_role: string
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          input_context: string
          input_metadata?: Json | null
          job_id: string
          latency_ms?: number | null
          model_used?: string | null
          output_content?: string | null
          output_metadata?: Json | null
          retry_count?: number | null
          shared_context?: Json | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["swarm_status"]
          tokens_input?: number | null
          tokens_output?: number | null
          worker_id?: string | null
        }
        Update: {
          agent_index?: number
          agent_role?: string
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          input_context?: string
          input_metadata?: Json | null
          job_id?: string
          latency_ms?: number | null
          model_used?: string | null
          output_content?: string | null
          output_metadata?: Json | null
          retry_count?: number | null
          shared_context?: Json | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["swarm_status"]
          tokens_input?: number | null
          tokens_output?: number | null
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "swarm_tasks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "swarm_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swarm_tasks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "v_active_swarm_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swarm_tasks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "v_completed_swarm_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      trading_rules: {
        Row: {
          active: boolean | null
          confidence: number | null
          created_at: string | null
          id: string
          last_validated: string | null
          rule_content: string
          rule_type: string
          success_count: number | null
          supporting_memory_ids: string[] | null
          violation_count: number | null
          workspace_id: string
        }
        Insert: {
          active?: boolean | null
          confidence?: number | null
          created_at?: string | null
          id?: string
          last_validated?: string | null
          rule_content: string
          rule_type: string
          success_count?: number | null
          supporting_memory_ids?: string[] | null
          violation_count?: number | null
          workspace_id: string
        }
        Update: {
          active?: boolean | null
          confidence?: number | null
          created_at?: string | null
          id?: string
          last_validated?: string | null
          rule_content?: string
          rule_type?: string
          success_count?: number | null
          supporting_memory_ids?: string[] | null
          violation_count?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trading_rules_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string | null
          default_system_prompt: string | null
          description: string | null
          id: string
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          default_system_prompt?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          default_system_prompt?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      v_active_swarm_jobs: {
        Row: {
          agent_count: number | null
          completed_count: number | null
          created_at: string | null
          failed_count: number | null
          id: string | null
          mode: string | null
          objective: string | null
          pending_count: number | null
          processing_count: number | null
          progress_pct: number | null
          started_at: string | null
          status: Database["public"]["Enums"]["swarm_status"] | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "swarm_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      v_completed_swarm_jobs: {
        Row: {
          agent_count: number | null
          avg_task_latency_ms: number | null
          completed_at: string | null
          completed_count: number | null
          created_at: string | null
          duration_seconds: number | null
          failed_count: number | null
          id: string | null
          mode: string | null
          objective: string | null
          status: Database["public"]["Enums"]["swarm_status"] | null
          synthesis_result: string | null
          total_tokens: number | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "swarm_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      calculate_fitness_score: {
        Args: {
          p_max_dd: number
          p_profit_factor: number
          p_sharpe: number
          p_sortino: number
          p_win_rate: number
        }
        Returns: number
      }
      check_graduation_ready: {
        Args: { p_strategy_id: string }
        Returns: {
          is_ready: boolean
          missing_criteria: string[]
          sharpe: number
          trade_count: number
          win_rate: number
        }[]
      }
      claim_swarm_tasks: {
        Args: { p_batch_size?: number; p_worker_id: string }
        Returns: {
          agent_index: number
          agent_role: string
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          input_context: string
          input_metadata: Json | null
          job_id: string
          latency_ms: number | null
          model_used: string | null
          output_content: string | null
          output_metadata: Json | null
          retry_count: number | null
          shared_context: Json | null
          started_at: string | null
          status: Database["public"]["Enums"]["swarm_status"]
          tokens_input: number | null
          tokens_output: number | null
          worker_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "swarm_tasks"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      close_shadow_position: {
        Args: {
          p_exit_ask: number
          p_exit_bid: number
          p_exit_price: number
          p_position_id: string
          p_regime: string
        }
        Returns: string
      }
      create_mutation: {
        Args: {
          p_code_content?: string
          p_dna_config: Json
          p_mutation_type?: string
          p_name: string
          p_parent_id: string
        }
        Returns: string
      }
      find_similar_warnings: {
        Args: {
          current_regime?: number
          match_workspace_id: string
          strategy_embedding: string
          threshold?: number
        }
        Returns: {
          created_at: string
          failure_type: string
          id: string
          in_sample_sharpe: number
          out_of_sample_sharpe: number
          pbo_score: number
          similarity: number
          warning_message: string
        }[]
      }
      get_experiment_summary: {
        Args: { match_experiment_id: string; match_workspace_id: string }
        Returns: {
          best_run_id: string
          best_sharpe: number
          checkpoint_count: number
          experiment_name: string
          last_checkpoint_notes: string
          total_runs: number
        }[]
      }
      get_job_status: {
        Args: { p_job_id: string }
        Returns: {
          avg_latency_ms: number
          completed_tasks: number
          failed_tasks: number
          job_id: string
          job_status: Database["public"]["Enums"]["swarm_status"]
          pending_tasks: number
          processing_tasks: number
          progress_pct: number
          total_tasks: number
          total_tokens: number
        }[]
      }
      get_memories_for_event: {
        Args: { event_name_filter: string; match_workspace_id: string }
        Returns: {
          content: string
          created_at: string
          id: string
          importance_score: number
          memory_type: string
          summary: string
        }[]
      }
      get_memory_provenance: {
        Args: { memory_id_input: string }
        Returns: {
          captured_at: string
          evidence_hash: string
          evidence_path: string
          evidence_type: string
          hash_valid: boolean
        }[]
      }
      get_regime_performance: {
        Args: {
          match_workspace_id: string
          min_confidence?: number
          profile_filter?: number
          regime_filter?: number
        }
        Returns: {
          avg_cagr: number
          avg_sharpe: number
          confidence_score: number
          last_updated: string
          profile_id: number
          regime_id: number
          run_ids: string[]
          total_runs: number
        }[]
      }
      get_top_strategies: {
        Args: {
          p_limit?: number
          p_status?: Database["public"]["Enums"]["strategy_status"]
        }
        Returns: {
          children_spawned: number
          fitness_score: number
          generation: number
          id: string
          name: string
          sharpe_ratio: number
        }[]
      }
      hybrid_search_memories: {
        Args: {
          bm25_weight?: number
          limit_count?: number
          match_workspace_id: string
          min_importance?: number
          query_embedding: string
          query_text: string
          vector_weight?: number
        }
        Returns: {
          bm25_score: number
          category: string
          content: string
          created_at: string
          hybrid_score: number
          id: string
          importance_score: number
          memory_type: string
          summary: string
          symbols: string[]
          vector_score: number
        }[]
      }
      is_context_cache_valid: {
        Args: { p_shared_context: Json }
        Returns: boolean
      }
      open_shadow_position: {
        Args: {
          p_entry_ask: number
          p_entry_bid: number
          p_entry_price: number
          p_expiry?: string
          p_latency_ms?: number
          p_option_type?: string
          p_quantity: number
          p_regime: string
          p_side: Database["public"]["Enums"]["position_side"]
          p_strategy_id: string
          p_strike?: number
          p_symbol: string
        }
        Returns: string
      }
      promote_strategy: {
        Args: { p_headline: string; p_narrative: string; p_strategy_id: string }
        Returns: string
      }
      promote_strategy_simple: {
        Args: { p_strategy_id: string }
        Returns: string
      }
      search_memory_notes: {
        Args: {
          match_count?: number
          match_threshold?: number
          match_workspace_id: string
          query_embedding: string
        }
        Returns: {
          content: string
          created_at: string
          id: string
          importance: string
          memory_type: string
          metadata: Json
          run_id: string
          similarity: number
          source: string
          tags: string[]
          workspace_id: string
        }[]
      }
      update_graduation_metrics: {
        Args: { p_strategy_id: string }
        Returns: undefined
      }
      update_job_progress: { Args: { p_job_id: string }; Returns: undefined }
    }
    Enums: {
      briefing_verdict: "pending" | "approved" | "rejected"
      graduation_status: "pending" | "graduated" | "failed" | "paused"
      position_side: "long" | "short"
      strategy_status: "incubating" | "active" | "failed" | "retired"
      swarm_status:
        | "pending"
        | "processing"
        | "completed"
        | "failed"
        | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      briefing_verdict: ["pending", "approved", "rejected"],
      graduation_status: ["pending", "graduated", "failed", "paused"],
      position_side: ["long", "short"],
      strategy_status: ["incubating", "active", "failed", "retired"],
      swarm_status: [
        "pending",
        "processing",
        "completed",
        "failed",
        "cancelled",
      ],
    },
  },
} as const
