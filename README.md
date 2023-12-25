# ddc-source-dictionary

Dictionary source for ddc.vim.

# Example

```vim
call ddc#custom#patch_global(#{
      \ sources: [ 'dictionary' ],
      \ sourceOptions: #{
      \   dictionary: #{
      \     mark: '[Dict]',
      \   },
      \ },
      \ sourceParams: #{
      \   dictionary: #{
      \     paths: [ '/usr/share/dict/words' ],
      \     exactLength: 2,
      \     firstCaseInsensitive: v:true,
      \     showPath: v:true,
      \     documentCommand: [ 'wn', '${item.word}', '-over' ],
      \     databasePath: stdpath('data') . '/ddc-source-dictionary.sqlite3',
      \   },
      \ },
      \})
```

See [doc](./doc/ddc-source-dictionary.txt) for details.
