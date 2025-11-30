import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WriteFileRequest {
  operation: 'write' | 'append' | 'patch' | 'delete' | 'rename' | 'copy' | 'create_dir';
  path: string;
  content?: string;
  diff?: string;
  newPath?: string; // for rename/copy
}

interface WriteFileResponse {
  success: boolean;
  backup_path?: string;
  preview?: string;
  error?: string;
  message?: string;
}

// Validate path to prevent directory traversal
function validatePath(path: string, engineRoot: string): { valid: boolean; fullPath: string; error?: string } {
  try {
    // Remove leading/trailing slashes and normalize
    const cleanPath = path.replace(/^\/+|\/+$/g, '').replace(/\/\//g, '/');
    
    // Prevent directory traversal
    if (cleanPath.includes('..') || cleanPath.startsWith('/')) {
      return { valid: false, fullPath: '', error: 'Invalid path: directory traversal not allowed' };
    }
    
    // Construct full path
    const fullPath = `${engineRoot}/${cleanPath}`;
    
    // SECURITY FIX: Resolve BOTH paths to prevent symlink attacks
    const realEngineRoot = Deno.realPathSync(engineRoot);
    const realTargetPath = Deno.realPathSync(fullPath);
    if (!realTargetPath.startsWith(realEngineRoot)) {
      return { valid: false, fullPath: '', error: 'Invalid path: outside rotation-engine root' };
    }
    
    return { valid: true, fullPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { valid: false, fullPath: '', error: `Path validation error: ${message}` };
  }
}

// Create backup of file before modification
async function createBackup(filePath: string, engineRoot: string): Promise<string | null> {
  try {
    const backupDir = `${engineRoot}/.backups`;
    await Deno.mkdir(backupDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = filePath.split('/').pop() || 'unknown';
    const backupPath = `${backupDir}/${fileName}.${timestamp}.bak`;
    
    const content = await Deno.readTextFile(filePath);
    await Deno.writeTextFile(backupPath, content);
    
    console.log(`Created backup: ${backupPath}`);
    return backupPath;
  } catch (error) {
    console.error('Backup creation failed:', error);
    return null;
  }
}

// Write entire file (create or overwrite)
async function writeFile(fullPath: string, content: string, engineRoot: string): Promise<WriteFileResponse> {
  try {
    // Create backup if file exists
    let backupPath: string | undefined;
    try {
      await Deno.stat(fullPath);
      const backup = await createBackup(fullPath, engineRoot);
      if (backup) backupPath = backup;
    } catch {
      // File doesn't exist, no backup needed
    }
    
    // Ensure directory exists
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    await Deno.mkdir(dir, { recursive: true });
    
    // Write file
    await Deno.writeTextFile(fullPath, content);
    
    return {
      success: true,
      backup_path: backupPath,
      message: `File written successfully${backupPath ? ' (backup created)' : ''}`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: `Write failed: ${message}`
    };
  }
}

// Append content to file
async function appendFile(fullPath: string, content: string, engineRoot: string): Promise<WriteFileResponse> {
  try {
    // Create backup if file exists
    let backupPath: string | undefined;
    try {
      await Deno.stat(fullPath);
      const backup = await createBackup(fullPath, engineRoot);
      if (backup) backupPath = backup;
    } catch {
      // File doesn't exist, will be created
    }
    
    // Read existing content
    let existing = '';
    try {
      existing = await Deno.readTextFile(fullPath);
    } catch {
      // File doesn't exist, start with empty
    }
    
    // Append with newline if needed
    const newContent = existing + (existing && !existing.endsWith('\n') ? '\n' : '') + content;
    
    // Write file
    await Deno.writeTextFile(fullPath, newContent);
    
    // Generate preview (last 20 lines)
    const lines = newContent.split('\n');
    const preview = lines.slice(-20).join('\n');
    
    return {
      success: true,
      backup_path: backupPath,
      preview,
      message: `Content appended successfully${backupPath ? ' (backup created)' : ''}`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: `Append failed: ${message}`
    };
  }
}

// Apply unified diff patch
async function applyPatch(fullPath: string, diff: string, engineRoot: string): Promise<WriteFileResponse> {
  try {
    // Create backup
    const backup = await createBackup(fullPath, engineRoot);
    
    // Read original file
    const original = await Deno.readTextFile(fullPath);
    
    // Parse and apply diff (simplified implementation)
    // In production, use a proper diff library
    const lines = original.split('\n');
    const diffLines = diff.split('\n');
    
    // This is a simplified patch application
    // TODO: Implement full unified diff parsing
    console.log('Patch application (simplified):', diffLines.length, 'diff lines');
    
    return {
      success: false,
      error: 'Patch application not yet fully implemented. Use /write_file for now.'
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: `Patch failed: ${message}`
    };
  }
}

// Delete file
async function deleteFile(fullPath: string, engineRoot: string): Promise<WriteFileResponse> {
  try {
    // Create backup before deletion
    const backup = await createBackup(fullPath, engineRoot);
    
    // Delete file
    await Deno.remove(fullPath);
    
    return {
      success: true,
      backup_path: backup || undefined,
      message: `File deleted successfully${backup ? ' (backup created)' : ''}`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: `Delete failed: ${message}`
    };
  }
}

// Rename/move file
async function renameFile(fullPath: string, newPath: string, engineRoot: string): Promise<WriteFileResponse> {
  try {
    // Validate new path
    const newValidation = validatePath(newPath, engineRoot);
    if (!newValidation.valid) {
      return { success: false, error: newValidation.error };
    }
    
    // Create backup
    const backup = await createBackup(fullPath, engineRoot);
    
    // Ensure destination directory exists
    const destDir = newValidation.fullPath.substring(0, newValidation.fullPath.lastIndexOf('/'));
    await Deno.mkdir(destDir, { recursive: true });
    
    // Rename/move
    await Deno.rename(fullPath, newValidation.fullPath);
    
    return {
      success: true,
      backup_path: backup || undefined,
      message: `File renamed/moved successfully${backup ? ' (backup created)' : ''}`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: `Rename failed: ${message}`
    };
  }
}

// Copy file
async function copyFile(fullPath: string, destPath: string, engineRoot: string): Promise<WriteFileResponse> {
  try {
    // Validate destination path
    const destValidation = validatePath(destPath, engineRoot);
    if (!destValidation.valid) {
      return { success: false, error: destValidation.error };
    }
    
    // Ensure destination directory exists
    const destDir = destValidation.fullPath.substring(0, destValidation.fullPath.lastIndexOf('/'));
    await Deno.mkdir(destDir, { recursive: true });
    
    // Copy file
    await Deno.copyFile(fullPath, destValidation.fullPath);
    
    return {
      success: true,
      message: 'File copied successfully'
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: `Copy failed: ${message}`
    };
  }
}

// Create directory
async function createDirectory(fullPath: string): Promise<WriteFileResponse> {
  try {
    await Deno.mkdir(fullPath, { recursive: true });
    
    return {
      success: true,
      message: 'Directory created successfully'
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: `Directory creation failed: ${message}`
    };
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const engineRoot = Deno.env.get('ROTATION_ENGINE_ROOT') || '/tmp/rotation-engine';
    console.log('Write operation request, engine root:', engineRoot);
    
    const body: WriteFileRequest = await req.json();
    const { operation, path, content, diff, newPath } = body;
    
    if (!path) {
      return new Response(
        JSON.stringify({ success: false, error: 'Path is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Validate path
    const validation = validatePath(path, engineRoot);
    if (!validation.valid) {
      return new Response(
        JSON.stringify({ success: false, error: validation.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    let result: WriteFileResponse;
    
    switch (operation) {
      case 'write':
        if (!content && content !== '') {
          return new Response(
            JSON.stringify({ success: false, error: 'Content is required for write operation' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        result = await writeFile(validation.fullPath, content, engineRoot);
        break;
        
      case 'append':
        if (!content && content !== '') {
          return new Response(
            JSON.stringify({ success: false, error: 'Content is required for append operation' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        result = await appendFile(validation.fullPath, content, engineRoot);
        break;
        
      case 'patch':
        if (!diff) {
          return new Response(
            JSON.stringify({ success: false, error: 'Diff is required for patch operation' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        result = await applyPatch(validation.fullPath, diff, engineRoot);
        break;
        
      case 'delete':
        result = await deleteFile(validation.fullPath, engineRoot);
        break;
        
      case 'rename':
        if (!newPath) {
          return new Response(
            JSON.stringify({ success: false, error: 'New path is required for rename operation' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        result = await renameFile(validation.fullPath, newPath, engineRoot);
        break;
        
      case 'copy':
        if (!newPath) {
          return new Response(
            JSON.stringify({ success: false, error: 'Destination path is required for copy operation' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        result = await copyFile(validation.fullPath, newPath, engineRoot);
        break;
        
      case 'create_dir':
        result = await createDirectory(validation.fullPath);
        break;
        
      default:
        return new Response(
          JSON.stringify({ success: false, error: `Unknown operation: ${operation}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
    
    return new Response(
      JSON.stringify(result),
      { 
        status: result.success ? 200 : 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
    
  } catch (error) {
    console.error('Write operation error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
