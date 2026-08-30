import { Component, inject } from '@angular/core'
import { MAT_DIALOG_DATA } from '@angular/material/dialog'

export interface DialogData {
  assetPack: 'robbie' | 'diffusion'
}

@Component({
  standalone: false,
  selector: 'app-asset-pack-dialog',
  templateUrl: './asset-pack-dialog.component.html',
  styleUrls: ['./asset-pack-dialog.component.scss']
})
export class AssetPackDialogComponent {
  data = inject<DialogData>(MAT_DIALOG_DATA)

}
