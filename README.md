# 横浜市施設予約 空き監視

横浜市市民利用施設予約システムの「日時から探す」を、GitHub Actionsから5分間隔で確認します。前回結果と異なる空きが検出されたときだけ、SlackまたはDiscordのWebhookに通知します。予約・申込操作は実行しません。

## セットアップ

1. このディレクトリをGitHubリポジトリのルートへコピーします。
2. GitHubの **Settings → Secrets and variables → Actions → Variables** に次の変数を登録します。
3. **Secrets** に `NOTIFY_WEBHOOK_URL` を登録します。SlackならIncoming Webhook、DiscordならWebhook URLです。
4. `NOTIFY_KIND` は `slack` または `discord` にします。
5. Actionsのワークフロー実行権限で、`Read and write permissions` を有効にします。`state.json`をコミットして差分判定に使うためです。
6. `workflow_dispatch`で手動実行し、検索条件と通知が正しいことを確認します。

## Variables

| 変数 | 例 | 内容 |
|---|---|---|
| `FROM_DATE` | `2026-10-01` | 利用開始日（必須） |
| `TO_DATE` | `2026-10-31` | 利用終了日（必須） |
| `FROM_TIME` | `09:00` | 開始時刻 |
| `TO_TIME` | `21:00` | 終了時刻 |
| `USAGE_CATEGORY` | `スポーツ` | `スポーツ / 文化 |
| `USAGE_PURPOSE` | `テニス` | サイト上の利用目的名と完全一致させる |
| `WEEKDAYS` | `土曜日,日曜日` | 空欄なら曜日指定なし |
| `SEARCH_TARGET` | `空きコマ` | `空きコマ` または `開放待ち` |
| `AREAS` | `港北区,都筑区` | 空欄なら区指定なし |
| `ROOM_TYPES` | `テニスコート（公園以外）` | 空欄なら室場種類指定なし |
| `NOTIFY_KIND` | `discord` | 通知先の形式 |

## 注意

対象サイトに過度な負荷をかけないよう、実行間隔は5分以上を推奨します。GitHub Actionsのスケジュール実行は混雑などで遅延することがあります。また、サイトの画面構成変更によりセレクタや空き判定の調整が必要になる場合があります。

このプログラムは公開画面の検索だけを行い、ログイン情報を扱いません。利用規約・運用ルールに反する自動取得や、空き枠の自動予約に拡張しないでください。
