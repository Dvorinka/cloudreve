package dbfs

import (
	"context"
	"testing"

	"github.com/cloudreve/Cloudreve/v4/ent/enttest"
	entfile "github.com/cloudreve/Cloudreve/v4/ent/file"
	"github.com/cloudreve/Cloudreve/v4/inventory"
	"github.com/cloudreve/Cloudreve/v4/inventory/types"
	"github.com/cloudreve/Cloudreve/v4/pkg/boolset"
	"github.com/cloudreve/Cloudreve/v4/pkg/filemanager/fs"
	"github.com/cloudreve/Cloudreve/v4/pkg/hashid"
	"github.com/samber/lo"
	"github.com/stretchr/testify/require"
)

func TestShareDefaultNaturalNameSort(t *testing.T) {
	client := enttest.Open(t, "sqlite3", "file:"+t.Name()+"?mode=memory&cache=shared")
	t.Cleanup(func() { require.NoError(t, client.Close()) })
	ctx := context.Background()
	hasher, err := hashid.New("share-sort-salt")
	require.NoError(t, err)

	policy := client.StoragePolicy.Create().SetName("local").SetType("local").SaveX(ctx)
	perms := &boolset.BooleanSet{}
	boolset.Sets(map[types.GroupPermission]bool{
		types.GroupPermissionShare:         true,
		types.GroupPermissionShareDownload: true,
	}, perms)
	group := client.Group.Create().SetName("g").SetPermissions(perms).SetStoragePolicies(policy).SaveX(ctx)
	owner := client.User.Create().SetEmail("owner@example.com").SetNick("o").SetGroup(group).SaveX(ctx)
	ownerRoot := client.File.Create().SetName(inventory.RootFolderName).
		SetType(int(types.FileTypeFolder)).SetOwner(owner).SaveX(ctx)
	folder := client.File.Create().SetName("album").SetType(int(types.FileTypeFolder)).
		SetOwner(owner).SetParent(ownerRoot).SaveX(ctx)

	// Insert out of numeric order so DB ID and lexicographic order both differ from 1..10.
	for _, spec := range []struct {
		name string
		typ  types.FileType
	}{
		{"10.jpg", types.FileTypeFile},
		{"2.jpg", types.FileTypeFile},
		{"1.jpg", types.FileTypeFile},
		{"part 10", types.FileTypeFolder},
		{"part 2", types.FileTypeFolder},
		{"part 1", types.FileTypeFolder},
		{"9.jpg", types.FileTypeFile},
	} {
		client.File.Create().SetName(spec.name).SetType(int(spec.typ)).
			SetOwner(owner).SetParent(folder).SaveX(ctx)
	}

	share := client.Share.Create().SetUser(owner).SetFile(folder).SaveX(ctx)
	visitor := client.User.Create().SetEmail("visitor@example.com").SetNick("v").SetGroup(group).SaveX(ctx)
	visitor.SetGroup(group)
	nav := multiShareNavigator(t, client, hasher, visitor)

	uri, err := fs.NewUriFromString(fs.NewShareUri(hashid.EncodeShareID(hasher, share.ID), ""))
	require.NoError(t, err)
	root, err := nav.To(ctx, uri)
	require.NoError(t, err)

	// Default share view auto-sorts by name ascending without mutating props.
	view := nav.GetView(ctx, root)
	require.NotNil(t, view)
	require.Equal(t, entfile.FieldName, view.Order)
	require.Equal(t, string(inventory.OrderDirectionAsc), view.OrderDirection)
	require.Nil(t, root.Model.Props)

	// Listing with that view returns folders first, then files, numbered 1..10.
	res, err := nav.Children(ctx, root, &ListArgs{
		Page: &inventory.PaginationArgs{
			PageSize: 100,
			OrderBy:  view.Order,
			Order:    inventory.OrderDirection(view.OrderDirection),
		},
	})
	require.NoError(t, err)
	require.Equal(t,
		[]string{"part 1", "part 2", "part 10", "1.jpg", "2.jpg", "9.jpg", "10.jpg"},
		lo.Map(res.Files, func(f *File, _ int) string { return f.Name() }),
	)

	// When ShareView is enabled, an explicit owner view order is preserved.
	root.disableView = false
	root.Model.Props = &types.FileProps{
		View: &types.ExplorerView{Order: entfile.FieldSize, OrderDirection: "desc", PageSize: 50},
	}
	customView := nav.GetView(ctx, root)
	require.Equal(t, entfile.FieldSize, customView.Order)
	require.Equal(t, "desc", customView.OrderDirection)
}

func TestMultiFileShareNaturalSort(t *testing.T) {
	client := enttest.Open(t, "sqlite3", "file:"+t.Name()+"?mode=memory&cache=shared")
	t.Cleanup(func() { require.NoError(t, client.Close()) })
	ctx := context.Background()
	hasher, err := hashid.New("multi-sort-salt")
	require.NoError(t, err)

	policy := client.StoragePolicy.Create().SetName("local").SetType("local").SaveX(ctx)
	perms := &boolset.BooleanSet{}
	boolset.Sets(map[types.GroupPermission]bool{
		types.GroupPermissionShare:         true,
		types.GroupPermissionShareDownload: true,
	}, perms)
	group := client.Group.Create().SetName("g").SetPermissions(perms).SetStoragePolicies(policy).SaveX(ctx)
	owner := client.User.Create().SetEmail("owner@example.com").SetNick("o").SetGroup(group).SaveX(ctx)
	ownerRoot := client.File.Create().SetName(inventory.RootFolderName).
		SetType(int(types.FileTypeFolder)).SetOwner(owner).SaveX(ctx)

	f10 := client.File.Create().SetName("10.pdf").SetType(int(types.FileTypeFile)).SetOwner(owner).SetParent(ownerRoot).SaveX(ctx)
	f2 := client.File.Create().SetName("2.pdf").SetType(int(types.FileTypeFile)).SetOwner(owner).SetParent(ownerRoot).SaveX(ctx)
	f1 := client.File.Create().SetName("1.pdf").SetType(int(types.FileTypeFile)).SetOwner(owner).SetParent(ownerRoot).SaveX(ctx)
	d2 := client.File.Create().SetName("folder 2").SetType(int(types.FileTypeFolder)).SetOwner(owner).SetParent(ownerRoot).SaveX(ctx)
	d10 := client.File.Create().SetName("folder 10").SetType(int(types.FileTypeFolder)).SetOwner(owner).SetParent(ownerRoot).SaveX(ctx)

	share := client.Share.Create().SetUser(owner).SetFile(f10).AddFiles(f10, f2, f1, d10, d2).SaveX(ctx)
	visitor := client.User.Create().SetEmail("visitor@example.com").SetNick("v").SetGroup(group).SaveX(ctx)
	visitor.SetGroup(group)
	nav := multiShareNavigator(t, client, hasher, visitor)

	uri, err := fs.NewUriFromString(fs.NewShareUri(hashid.EncodeShareID(hasher, share.ID), ""))
	require.NoError(t, err)
	root, err := nav.To(ctx, uri)
	require.NoError(t, err)

	res, err := nav.Children(ctx, root, &ListArgs{Page: &inventory.PaginationArgs{PageSize: 100}})
	require.NoError(t, err)
	require.Equal(t,
		[]string{"folder 2", "folder 10", "1.pdf", "2.pdf", "10.pdf"},
		lo.Map(res.Files, func(f *File, _ int) string { return f.Name() }),
	)
}
