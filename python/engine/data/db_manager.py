import duckdb
import os
import glob
import json

class DataEngine:
    """
    The High-Performance Sidecar for M4 Pro.
    Connects directly to Parquet files for zero-copy queries.
    """
    def __init__(self, db_path=":memory:"):
        self.con = duckdb.connect(db_path)
        self.con.execute("INSTALL parquet; LOAD parquet;")

        # 1. Detect Data Path (VelocityData or Local)
        # Prioritize env var, fall back to hardcoded M4 path
        self.data_path = os.environ.get('DATA_DIR', '/Volumes/VelocityData/velocity_om/parquet/stock/SPY')

        # 2. Register Virtual View (Zero Memory Cost)
        # This doesn't load data; it just maps the file structure
        try:
            # Check if files exist first to avoid crash
            files = glob.glob(os.path.join(self.data_path, "*.parquet"))
            if files:
                print(f"[DataEngine] Mounting {len(files)} Parquet files from {self.data_path}")
                self.con.execute(f"CREATE OR REPLACE VIEW stock_data AS SELECT * FROM read_parquet('{self.data_path}/*.parquet')")
            else:
                print(f"[DataEngine] ⚠️ No parquet files found in {self.data_path}")
        except Exception as e:
            print(f"[DataEngine] Initialization Warning: {e}")

    def query(self, sql: str) -> list[dict]:
        """
        Execute raw SQL against the parquet lake.
        Returns pure JSON-ready dictionaries.
        """
        try:
            # .df() converts to pandas (fast on M4), then to dict
            return self.con.execute(sql).df().to_dict(orient='records')
        except Exception as e:
            return [{"error": f"Query failed: {str(e)}"}]

# Singleton instance for easy import
engine = DataEngine()
