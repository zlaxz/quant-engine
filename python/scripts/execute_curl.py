import subprocess
import sys

def run_curl_test():
    print("Executing curl script...")
    try:
        # Give execution permission just in case, though subprocess usually handles it if passed to bash
        result = subprocess.run(['bash', 'scripts/test_deepseek_curl.sh'], 
                              capture_output=True, 
                              text=True, 
                              timeout=30)
        
        print("STDOUT:", result.stdout)
        print("STDERR:", result.stderr)
        
        if result.returncode != 0:
            print(f"Script failed with code {result.returncode}")
            sys.exit(1)
            
    except Exception as e:
        print(f"Execution Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    run_curl_test()
