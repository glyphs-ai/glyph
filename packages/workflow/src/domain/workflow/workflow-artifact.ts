export interface WorkflowArtifactFile {
  readonly relPath: string;
  readonly size: number;
  readonly modifiedAt: string;
}

export type WorkflowArtifactListingFailed = {
  readonly type: "WorkflowArtifactListingFailed";
  readonly cause: unknown;
};
