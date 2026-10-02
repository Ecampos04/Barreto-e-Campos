import React, { useState, useMemo } from 'react';
import { 
  ShieldCheck, 
  FolderSync, 
  AlertTriangle, 
  CheckCircle2, 
  FileQuestion, 
  X, 
  FolderPlus, 
  ArrowRight, 
  Sparkles, 
  Eye, 
  ExternalLink,
  Layers,
  Tag as TagIcon
} from 'lucide-react';
import { DriveFile, FolderNode, CustomCategory } from '../types/drive';
import { formatDate, formatFileSize, getMimeTypeLabel } from '../utils/formatters';
import { ConfirmationModal } from './ConfirmationModal';
import { 
  createFolderInDrive, 
  moveFileOrFolderToDestination, 
  updateFileTagsAndCategory, 
  DriveContext 
} from '../services/driveApi';

interface SmartBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  files: DriveFile[];
  allFolders: FolderNode[];
  driveContext: DriveContext | null;
  categories: CustomCategory[];
  accessToken: string;
  onRefreshData: () => Promise<void>;
  showToast: (text: string, type?: 'success' | 'error') => void;
  onPreviewFile: (file: DriveFile) => void;
  onNotifyBackupCompleted?: (count: number, targetFolderName: string) => void;
}

export const SmartBackupModal: React.FC<SmartBackupModalProps> = ({
  isOpen,
  onClose,
  files,
  allFolders,
  driveContext,
  categories,
  accessToken,
  onRefreshData,
  showToast,
  onPreviewFile,
  onNotifyBackupCompleted,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [showConfirmBulk, setShowConfirmBulk] = useState(false);
  const [singleMoveTarget, setSingleMoveTarget] = useState<DriveFile | null>(null);

  // Identify all orphan files: non-folders that have no category and no tags
  const orphanFiles = useMemo(() => {
    return files.filter(f => !f.isFolder && !f.category && (!f.tags || f.tags.length === 0));
  }, [files]);

  // Find existing "Revisão Necessária" folder
  const revisionFolder = useMemo(() => {
    const flatten = (nodes: FolderNode[]): FolderNode[] => {
      let res: FolderNode[] = [];
      for (const n of nodes) {
        res.push(n);
        if (n.children && n.children.length > 0) res = res.concat(flatten(n.children));
      }
      return res;
    };
    const flat = flatten(allFolders);
    return flat.find(f => {
      const n = f.name.toLowerCase();
      return n.includes('revisao necessaria') || n.includes('revisão necessária') || n.includes('revisao');
    });
  }, [allFolders]);

  const suggestCategoryForFile = (fileName: string): string => {
    const lower = fileName.toLowerCase();
    if (lower.includes('contrato') || lower.includes('minuta') || lower.includes('acordo')) return 'Contratos & Minutas';
    if (lower.includes('processo') || lower.includes('peticao') || lower.includes('petição') || lower.includes('recurso') || lower.includes('inicial')) return 'Processos Judiciais';
    if (lower.includes('societario') || lower.includes('estatuto') || lower.includes('ata')) return 'Societário & Atas';
    if (lower.includes('darf') || lower.includes('tribut') || lower.includes('fiscal') || lower.includes('imposto')) return 'Tributário & Fiscal';
    if (lower.includes('trabalh') || lower.includes('rescis') || lower.includes('rh')) return 'Trabalhista & RH';
    if (lower.includes('recibo') || lower.includes('honorario') || lower.includes('comprovante') || lower.includes('custas')) return 'Financeiro & Custas';
    if (lower.includes('procuracao') || lower.includes('procuração') || lower.includes('rg') || lower.includes('cpf')) return 'Clientes & Cadastros';
    return 'Administrativo & Escritório';
  };

  const getOrCreateRevisionFolder = async (): Promise<string> => {
    if (revisionFolder) return revisionFolder.id;
    if (!driveContext || !accessToken) throw new Error('Drive não conectado.');

    const newFolder = await createFolderInDrive(
      accessToken,
      driveContext,
      '00 - Revisão Necessária',
      driveContext.rootFolderId
    );
    return newFolder.id;
  };

  // Bulk move all orphan files to "Revisão Necessária"
  const handleExecuteBulkSync = async () => {
    if (orphanFiles.length === 0 || !driveContext || !accessToken) return;

    setIsProcessing(true);
    setShowConfirmBulk(false);

    try {
      const targetFolderId = await getOrCreateRevisionFolder();
      let successCount = 0;

      for (const file of orphanFiles) {
        try {
          const oldParent = file.parents && file.parents.length > 0 ? file.parents[0] : null;
          await moveFileOrFolderToDestination(accessToken, file.id, targetFolderId, oldParent);

          // Auto-tag with "Aguardando Revisão" and sensible category
          const suggestedCat = suggestCategoryForFile(file.name);
          await updateFileTagsAndCategory(accessToken, file.id, suggestedCat, ['Aguardando Revisão']);
          successCount++;
        } catch (fileErr) {
          console.warn(`Failed to move file ${file.name}:`, fileErr);
        }
      }

      showToast(`${successCount} arquivos órfãos sincronizados para 'Revisão Necessária' com sucesso!`);
      if (onNotifyBackupCompleted) {
        onNotifyBackupCompleted(successCount, revisionFolder?.name || '00 - Revisão Necessária');
      }
      await onRefreshData();
    } catch (err: any) {
      console.error('Error during bulk orphan sync:', err);
      showToast('Erro ao sincronizar arquivos órfãos: ' + err.message, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // Move single orphan file
  const handleExecuteSingleSync = async () => {
    if (!singleMoveTarget || !driveContext || !accessToken) return;

    setIsProcessing(true);
    const file = singleMoveTarget;
    setSingleMoveTarget(null);

    try {
      const targetFolderId = await getOrCreateRevisionFolder();
      const oldParent = file.parents && file.parents.length > 0 ? file.parents[0] : null;

      await moveFileOrFolderToDestination(accessToken, file.id, targetFolderId, oldParent);
      const suggestedCat = suggestCategoryForFile(file.name);
      await updateFileTagsAndCategory(accessToken, file.id, suggestedCat, ['Aguardando Revisão']);

      showToast(`Arquivo "${file.name}" movido para 'Revisão Necessária' e marcado para revisão!`);
      if (onNotifyBackupCompleted) {
        onNotifyBackupCompleted(1, revisionFolder?.name || '00 - Revisão Necessária');
      }
      await onRefreshData();
    } catch (err: any) {
      console.error('Error moving file to revision:', err);
      showToast('Erro ao mover arquivo: ' + err.message, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-5 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-4xl w-full border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-slate-900 dark:text-white text-base">
                  Backup Inteligente & Auditoria de Arquivos Órfãos
                </h2>
                <span className="text-[10px] bg-amber-500/20 text-amber-800 dark:text-amber-300 font-bold px-2 py-0.5 rounded-full border border-amber-500/30">
                  Monitoramento Ativo
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Localiza arquivos sem categoria ou etiqueta e organiza na pasta "Revisão Necessária"
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* Status Banner */}
          <div className="bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={`p-2.5 rounded-xl ${orphanFiles.length > 0 ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400' : 'bg-emerald-500/20 text-emerald-500'}`}>
                {orphanFiles.length > 0 ? <AlertTriangle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
              </div>
              <div>
                <div className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
                  {orphanFiles.length > 0
                    ? `${orphanFiles.length} arquivos órfãos identificados no Drive`
                    : 'Excelente! Todos os arquivos estão categorizados ou etiquetados'}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {orphanFiles.length > 0
                    ? 'Arquivos sem classificação correm o risco de se perder. Sugerimos sincronizá-los para a pasta "Revisão Necessária".'
                    : 'Nenhum documento órfão no momento. O drive BARRETO E CAMPOS está com 100% de integridade.'}
                </p>
              </div>
            </div>

            {orphanFiles.length > 0 && (
              <button
                onClick={() => setShowConfirmBulk(true)}
                disabled={isProcessing}
                className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors whitespace-nowrap self-start sm:self-auto disabled:opacity-50 cursor-pointer"
              >
                <FolderSync className="w-4 h-4" />
                <span>Sincronizar Todos ({orphanFiles.length})</span>
              </button>
            )}
          </div>

          {/* List of Orphan Files */}
          {orphanFiles.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <span>Arquivos Pendentes de Classificação:</span>
                <span>Pasta Destino: {revisionFolder ? `📁 ${revisionFolder.name}` : '📁 00 - Revisão Necessária (será criada)'}</span>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-850">
                {orphanFiles.map((file) => {
                  const suggestedCat = suggestCategoryForFile(file.name);

                  return (
                    <div
                      key={file.id}
                      className="p-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-600 shrink-0 mt-0.5">
                          <FileQuestion className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-800 dark:text-slate-200 truncate" title={file.name}>
                            {file.name}
                          </div>
                          <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                            <span>{getMimeTypeLabel(file.mimeType)}</span>
                            <span>•</span>
                            <span>{formatFileSize(file.size)}</span>
                            <span>•</span>
                            <span>{formatDate(file.modifiedTime)}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            <span className="text-[10px] text-slate-400">Sugestão automática:</span>
                            <span className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-medium text-[10px] border border-blue-200 dark:border-blue-800">
                              {suggestedCat}
                            </span>
                            <span className="px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 font-medium text-[10px] border border-amber-200 dark:border-amber-800">
                              #Aguardando Revisão
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                        <button
                          onClick={() => onPreviewFile(file)}
                          className="p-1.5 text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
                          title="Visualização Rápida"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setSingleMoveTarget(file)}
                          disabled={isProcessing}
                          className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-amber-600 hover:text-white dark:bg-slate-800 dark:hover:bg-amber-600 text-slate-700 dark:text-slate-200 rounded-lg font-medium transition-colors cursor-pointer"
                          title="Mover para Revisão Necessária"
                        >
                          <ArrowRight className="w-3.5 h-3.5" />
                          <span>Mover para Revisão</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="py-12 text-center space-y-2 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
              <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
                Nenhum arquivo órfão no Drive
              </h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                O Backup Inteligente monitora ativamente a pasta BARRETO E CAMPOS. Novos arquivos sem categoria serão sinalizados aqui.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-50 dark:bg-slate-850 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>Preserva a integridade e segurança de todos os documentos do escritório</span>
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>

      {/* Confirmation Modal for Bulk Sync */}
      <ConfirmationModal
        isOpen={showConfirmBulk}
        title="Confirmar Sincronização de Arquivos Órfãos"
        message={`Deseja transferir todos os ${orphanFiles.length} arquivos órfãos para a pasta 'Revisão Necessária'?\n\nEles serão movidos diretamente no Google Drive e etiquetados como 'Aguardando Revisão' com sugestão de categoria.`}
        confirmLabel={`Sincronizar ${orphanFiles.length} Arquivos`}
        cancelLabel="Cancelar"
        isDestructive={false}
        onConfirm={handleExecuteBulkSync}
        onCancel={() => setShowConfirmBulk(false)}
      />

      {/* Confirmation Modal for Single Sync */}
      <ConfirmationModal
        isOpen={!!singleMoveTarget}
        title="Mover Arquivo para Revisão Necessária"
        message={`Deseja transferir o arquivo "${singleMoveTarget?.name}" para a pasta 'Revisão Necessária'?`}
        confirmLabel="Confirmar e Mover"
        cancelLabel="Cancelar"
        isDestructive={false}
        onConfirm={handleExecuteSingleSync}
        onCancel={() => setSingleMoveTarget(null)}
      />
    </div>
  );
};
